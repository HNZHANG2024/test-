import { DataPoint, AttributeConfig, SkylineResult } from "../types";
// ---- WebGPU type fallbacks for TypeScript ----
type GPUDevice = any;
type GPUQueue = any;
type GPUBuffer = any;
type GPUComputePipeline = any;
type GPUBindGroupLayout = any;


const SHADER_CODE = `
struct Result {
  dominatedBy: u32,
  dominatingScore: u32,
}

struct Params {
  dimensions: u32,
  count: u32,
}

@group(0) @binding(0) var<storage, read> data: array<f32>;
@group(0) @binding(1) var<storage, read_write> results: array<Result>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let i = global_id.x;
  if (i >= params.count) { return; }

  var d_by = 0u;
  var d_score = 0u;

  let i_off = i * params.dimensions;

  for (var j = 0u; j < params.count; j = j + 1u) {
    if (i == j) { continue; }
    let j_off = j * params.dimensions;

    var i_be_j = true;  // i >= j for all dims?
    var i_s_j  = false; // i > j for some dim?
    var j_be_i = true;  // j >= i for all dims?
    var j_s_i  = false; // j > i for some dim?

    for (var d = 0u; d < params.dimensions; d = d + 1u) {
      let v_i = data[i_off + d];
      let v_j = data[j_off + d];

      if (v_i < v_j) { i_be_j = false; j_s_i = true; }
      if (v_i > v_j) { j_be_i = false; i_s_j = true; }

      if (!i_be_j && !j_be_i) { break; }
    }

    if (i_be_j && i_s_j) { d_score = d_score + 1u; } // i dominates j
    if (j_be_i && j_s_i) { d_by    = d_by + 1u; }     // j dominates i
  }

  results[i].dominatedBy = d_by;
  results[i].dominatingScore = d_score;
}
`;

// ---- WebGPU cached objects / buffers (module-level singletons) ----
type GPUState = {
  device: any;
  queue: any;
  pipeline: any;
  bindGroupLayout: any;
};

let gpuStatePromise: Promise<GPUState> | null = null;

let dataBuf: GPUBuffer | null = null;
let dataBufBytes = 0;

let resultBuf: GPUBuffer | null = null;
let resultBufBytes = 0;

let uniformBuf: GPUBuffer | null = null;
let uniformBufBytes = 0;

let readbackBuf: GPUBuffer | null = null;
let readbackBufBytes = 0;

function getWebGPUEnums() {
  // Prefer global enums; fall back to window casting if TS lib lacks them
  const GPUBufferUsageEnum = (globalThis as any).GPUBufferUsage ?? (window as any).GPUBufferUsage;
  const GPUMapModeEnum = (globalThis as any).GPUMapMode ?? (window as any).GPUMapMode;
  if (!GPUBufferUsageEnum || !GPUMapModeEnum) {
    throw new Error("WebGPU enums not available (GPUBufferUsage/GPUMapMode).");
  }
  return { GPUBufferUsageEnum, GPUMapModeEnum };
}

async function getGPUState(): Promise<GPUState> {
  if (gpuStatePromise) return gpuStatePromise;

  gpuStatePromise = (async () => {
    const navGpu = (navigator as any).gpu;
    if (!navGpu) throw new Error("WebGPU unavailable");

    const adapter = await navGpu.requestAdapter();
    if (!adapter) throw new Error("Failed to request WebGPU adapter");

    const device: GPUDevice = await adapter.requestDevice();
    const queue = device.queue;

    const module = device.createShaderModule({ code: SHADER_CODE });
    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });

    const bindGroupLayout = pipeline.getBindGroupLayout(0);

    return { device, queue, pipeline, bindGroupLayout };
  })();

  return gpuStatePromise;
}

function ensureBuffer(
  device: GPUDevice,
  buf: GPUBuffer | null,
  currentBytes: number,
  neededBytes: number,
  usage: number
): { buf: GPUBuffer; bytes: number } {
  if (buf && currentBytes >= neededBytes) return { buf, bytes: currentBytes };
  if (buf) buf.destroy();
  const newBuf = device.createBuffer({ size: neededBytes, usage });
  return { buf: newBuf, bytes: neededBytes };
}

export const computeSkylineWebGPU = async (
  data: DataPoint[],
  attrs: AttributeConfig[]
): Promise<SkylineResult> => {
  const start = performance.now();
  if (data.length === 0 || attrs.length === 0) {
    return {
      skylineIds: new Set(),
      dominanceScores: {},
      dominatedBy: {},
      computationTime: performance.now() - start,
      method: "WebGPU",
    };
  }

  const { GPUBufferUsageEnum, GPUMapModeEnum } = getWebGPUEnums();
  const { device, queue, pipeline, bindGroupLayout } = await getGPUState();

  const count = data.length;
  const dims = attrs.length;

  // Flatten data -> SoA-ish would be better, but keep your AoS->flat for now
  const flat = new Float32Array(count * dims);
  for (let i = 0; i < count; i++) {
    const row = data[i] as any;
    const base = i * dims;
    for (let d = 0; d < dims; d++) {
      const v = Number(row[attrs[d].key]);
      flat[base + d] = Number.isFinite(v) ? v : 0;
    }
  }

  // Buffers
  const needDataBytes = flat.byteLength;
  const needResultBytes = count * 8; // Result: 2*u32
  const needUniformBytes = 8;        // dims(u32) + count(u32)
  const needReadbackBytes = count * 8;

  {
    const r = ensureBuffer(
      device,
      dataBuf,
      dataBufBytes,
      needDataBytes,
      GPUBufferUsageEnum.STORAGE | GPUBufferUsageEnum.COPY_DST
    );
    dataBuf = r.buf; dataBufBytes = r.bytes;
  }

  {
    const r = ensureBuffer(
      device,
      resultBuf,
      resultBufBytes,
      needResultBytes,
      GPUBufferUsageEnum.STORAGE | GPUBufferUsageEnum.COPY_SRC
    );
    resultBuf = r.buf; resultBufBytes = r.bytes;
  }

  {
    const r = ensureBuffer(
      device,
      uniformBuf,
      uniformBufBytes,
      needUniformBytes,
      GPUBufferUsageEnum.UNIFORM | GPUBufferUsageEnum.COPY_DST
    );
    uniformBuf = r.buf; uniformBufBytes = r.bytes;
  }

  {
    const r = ensureBuffer(
      device,
      readbackBuf,
      readbackBufBytes,
      needReadbackBytes,
      GPUBufferUsageEnum.COPY_DST | GPUBufferUsageEnum.MAP_READ
    );
    readbackBuf = r.buf; readbackBufBytes = r.bytes;
  }

  // Upload
  queue.writeBuffer(dataBuf!, 0, flat);
  queue.writeBuffer(uniformBuf!, 0, new Uint32Array([dims, count]));

  // Bind group (cheap-ish; could cache per buffer combo, but fine)
  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: dataBuf! } },
      { binding: 1, resource: { buffer: resultBuf! } },
      { binding: 2, resource: { buffer: uniformBuf! } }, // Params { dims, count }
    ],
  });


  // Encode + dispatch + copy to readback
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(count / 64));
  pass.end();

  encoder.copyBufferToBuffer(resultBuf!, 0, readbackBuf!, 0, needReadbackBytes);
  queue.submit([encoder.finish()]);
  await queue.onSubmittedWorkDone();


  // Map readback (ensure previous mapping is released)
  try {
    await readbackBuf!.mapAsync(GPUMapModeEnum.READ);
  } catch (e) {

    try {
      readbackBuf!.unmap();
      await readbackBuf!.mapAsync(GPUMapModeEnum.READ);
    } catch (e2) {
      throw e2;
    }
  }

  const mapped = readbackBuf!.getMappedRange();
  const res = new Uint32Array(mapped);

  const skylineIds = new Set<string>();
  const dominanceScores: Record<string, number> = {};
  const dominatedBy: Record<string, number> = {};

  for (let i = 0; i < count; i++) {
    const id = data[i].id;
    const dBy = res[i * 2];
    const dScore = res[i * 2 + 1];
    dominatedBy[id] = dBy;
    dominanceScores[id] = dScore;
    if (dBy === 0) skylineIds.add(id);
  }

  readbackBuf!.unmap();

  return {
    skylineIds,
    dominanceScores,
    dominatedBy,
    computationTime: performance.now() - start,
    method: "WebGPU",
  };
};
