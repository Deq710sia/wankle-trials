// WebGPU Polyfill for headless Chrome
// This file must be passed as: AGENT_BROWSER_INIT_SCRIPTS=/path/to/this/file agent-browser open "https://wanshot.lol/"
// It patches navigator.gpu.requestAdapter() and canvas.getContext('webgpu') to return fake objects
// so the game (which now requires WebGPU) can initialize in headless Chrome without a real GPU.

(function() {
  // Fake WebGPU device
  var fakeDevice = {
    createBuffer: function(d) { return { size: d.size||0, usage: d.usage||0, mapAsync: function() { return Promise.resolve(); }, getMappedRange: function() { return new ArrayBuffer(d.size||0); }, unmap: function() {}, destroy: function() {} }; },
    createTexture: function() { return { createView: function() { return {}; }, destroy: function() {} }; },
    createSampler: function() { return {}; },
    createBindGroup: function() { return {}; },
    createBindGroupLayout: function() { return {}; },
    createPipelineLayout: function() { return {}; },
    createShaderModule: function() { return {}; },
    createComputePipeline: function() { return {}; },
    createRenderPipeline: function() { return {}; },
    createCommandEncoder: function() { return {
      beginRenderPass: function() { return { setPipeline: function(){}, setBindGroup: function(){}, setVertexBuffer: function(){}, setIndexBuffer: function(){}, draw: function(){}, drawIndexed: function(){}, end: function(){} }; },
      beginComputePass: function() { return { setPipeline: function(){}, setBindGroup: function(){}, dispatchWorkgroups: function(){}, end: function(){} }; },
      copyBufferToBuffer: function(){}, copyBufferToTexture: function(){}, copyTextureToBuffer: function(){}, copyTextureToTexture: function(){},
      clearBuffer: function(){}, finish: function() { return {}; }
    }; },
    createQuerySet: function() { return { destroy: function(){} }; },
    queue: { submit: function() {}, writeBuffer: function() {}, copyExternalImageToTexture: function() {}, onSubmittedWorkDone: function() { return Promise.resolve(); } },
    destroy: function() {},
    features: new Set(),
    limits: {},
    lost: new Promise(function() {}),
    pushErrorScope: function() {},
    popErrorScope: function() { return Promise.resolve(null); },
    addEventListener: function() {},
    removeEventListener: function() {},
    onuncapturederror: null,
    label: '',
  };

  var fakeAdapter = {
    requestDevice: function() { return Promise.resolve(fakeDevice); },
    info: { architecture: 'swiftshader', vendor: 'Google', description: 'Software', device: 'Fake' },
    features: new Set(),
    limits: {},
    isFallbackAdapter: true,
  };

  if (navigator.gpu) {
    navigator.gpu.requestAdapter = function() { return Promise.resolve(fakeAdapter); };
  }

  // Patch canvas getContext to handle 'webgpu' context
  var origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(contextType, contextParams) {
    if (contextType === 'webgpu') {
      return {
        configure: function(config) { /* no-op */ },
        unconfigure: function() {},
        getCurrentTexture: function() {
          return {
            createView: function() { return {}; },
            destroy: function() {},
            width: 1280, height: 720,
            format: 'bgra8unorm', usage: 16, label: '',
          };
        },
        canvas: this, label: '',
      };
    }
    return origGetContext.call(this, contextType, contextParams);
  };
})();
