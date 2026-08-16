const DEFAULT_WIDTH = 310;
const DEFAULT_HEIGHT = 310;

// Prepended to every fragment shader so the colorspace helpers only exist in
// one place. highp is declared up front because sRGB encoding does a pow();
// a shader is still free to drop back to mediump for its own declarations.
const FRAGMENT_PRELUDE = `precision highp float;

// Rec. 709 / sRGB relative-luminance weights. Uploaded images are sRGB, so
// these are the coefficients that match their primaries. Rec. 2020's
const vec3 LUMINANCE_709 = vec3(0.2126, 0.7152, 0.0722);

// Textures are uploaded as SRGB8_ALPHA8, so texture() already hands back
// LINEAR light. Weighting linear values gives relative luminance (Y); the
// same weights against encoded values would give luma (Y'), a different
// quantity despite the identical numbers.
float luminance(vec3 linearRgb)
{
    return dot(linearRgb, LUMINANCE_709);
}

// The default drawing buffer has no automatic sRGB encode -- whatever we
// write out is read back as an sRGB code value.
vec3 linearToSrgb(vec3 c)
{
    return mix(12.92 * c,
               1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055,
               step(vec3(0.0031308), c));
}

float linearToSrgb(float c)
{
    return linearToSrgb(vec3(c)).r;
}
`;

const FRAGMENT_PRELUDE_LINES = FRAGMENT_PRELUDE.split("\n").length - 1;

function withFragmentPrelude(source) {
    const version = source.match(/^\s*#version[^\n]*\n/);

    if (!version) {
        return FRAGMENT_PRELUDE + source;
    }

    return version[0] + FRAGMENT_PRELUDE + source.slice(version[0].length);
}

class OpenGLCanvas extends HTMLElement {
    constructor({
        width = DEFAULT_WIDTH,
        height = DEFAULT_HEIGHT
    } = {}) {
        super();

        const shadow = this.attachShadow({ mode: "open" });

        this.canvas = document.createElement("canvas");

        // The canvas is laid out in CSS pixels but the drawing buffer is sized
        // in device pixels, so a 2x display gets a 2x buffer instead of a
        // 310x310 image the compositor has to upscale.
        this.cssWidth = Number(this.getAttribute("width")) || width;
        this.cssHeight = Number(this.getAttribute("height")) || height;
        this.#resizeDrawingBuffer();

        shadow.appendChild(this.canvas);
        const styleEl = document.createElement("style");
        styleEl.innerText = `
            :host {
                display: inline-block;
            }
        `;
        shadow.appendChild(styleEl);

        this.gl = this.canvas.getContext("webgl2");

        if (!this.gl) {
            throw new Error("WebGL2 is not supported.");
        }

        this.vertexBuffer = this.gl.createBuffer();
        this.texture = this.gl.createTexture();

        this.program = null;
        this.vertexCount = 0;
        this.vertexStride = 0;
        this.vertexLayout = null;

        // name -> float, re-applied on every draw so uniforms can be set
        // before the shaders have finished loading
        this.floatUniforms = new Map();

        // Remembered so a devicePixelRatio change can repaint what was last
        // drawn; resizing the buffer clears it.
        this.lastDrawMode = null;

        this.#watchDevicePixelRatio();
    }

    connectedCallback() {
        this.#loadShaders();
    }

    // devicePixelRatio changes when the window moves between displays or the
    // page is zoomed. There is no event for it, but a resolution media query
    // flips as soon as the current ratio stops matching.
    #watchDevicePixelRatio() {
        const onChange = () => {
            this.#resizeDrawingBuffer();

            if (this.lastDrawMode !== null) {
                this.draw(this.lastDrawMode);
            }

            this.#watchDevicePixelRatio();
        };

        matchMedia(
            `(resolution: ${window.devicePixelRatio}dppx)`
        ).addEventListener("change", onChange, { once: true });
    }

    #resizeDrawingBuffer() {
        const ratio = window.devicePixelRatio || 1;

        this.canvas.width = Math.round(this.cssWidth * ratio);
        this.canvas.height = Math.round(this.cssHeight * ratio);
        this.canvas.style.width = `${this.cssWidth}px`;
        this.canvas.style.height = `${this.cssHeight}px`;
    }

    get ready() {
        return this.program && this.vertexLayout;
    }

    // width/height are the CSS size; drawingBufferWidth/Height are the device
    // pixels actually rendered.
    get width() {
        return this.cssWidth;
    }

    set width(width) {
        this.cssWidth = width;
        this.#resizeDrawingBuffer();
    }

    get height() {
        return this.cssHeight;
    }

    set height(height) {
        this.cssHeight = height;
        this.#resizeDrawingBuffer();
    }

    get drawingBufferWidth() {
        return this.canvas.width;
    }

    get drawingBufferHeight() {
        return this.canvas.height;
    }

    async #loadShaders() {
        const vertexPath = this.getAttribute("vertex-shader");
        const fragmentPath = this.getAttribute("fragment-shader");

        if (!vertexPath || !fragmentPath) {
            return;
        }

        const [vertexSource, fragmentSource] = await Promise.all([
            fetch(vertexPath).then(r => {
                if (!r.ok) {
                    throw new Error(`Failed to load vertex shader: ${vertexPath}`);
                }
                return r.text();
            }),
            fetch(fragmentPath).then(r => {
                if (!r.ok) {
                    throw new Error(`Failed to load fragment shader: ${fragmentPath}`);
                }
                return r.text();
            })
        ]);

        this.program = this.#createProgram(vertexSource, fragmentSource);
        this.gl.useProgram(this.program);
        this.dispatchEvent(new Event("ready"));
    }

    set vertexData({
        data,
        size,
        attribute,
        attributes,
        usage = this.gl.STATIC_DRAW
    }) {
        const gl = this.gl;

        const layout = attributes ?? [{ name: attribute, size }];

        const vertices = data instanceof Float32Array
            ? data
            : new Float32Array(data);

        const stride = layout.reduce((total, a) => total + a.size, 0);

        this.vertexCount = vertices.length / stride;
        this.vertexStride = stride;
        this.vertexLayout = layout;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, usage);
    }

    uniform1f(name, value) {
        this.floatUniforms.set(name, value);
    }

    draw(mode = this.gl.TRIANGLES) {
        if (!this.program) {
            throw new Error("Shaders have not finished loading.");
        }

        if (!this.vertexLayout) {
            throw new Error("No vertex data has been assigned.");
        }

        const gl = this.gl;

        gl.useProgram(this.program);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);

        const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;
        const stride = this.vertexStride * FLOAT_BYTES;

        let offset = 0;

        for (const { name, size } of this.vertexLayout) {
            const location = gl.getAttribLocation(this.program, name);

            if (location === -1) {
                throw new Error(
                    `Attribute "${name}" not found in shader.`
                );
            }

            gl.enableVertexAttribArray(location);

            gl.vertexAttribPointer(
                location,
                size,
                gl.FLOAT,
                false,
                stride,
                offset
            );

            offset += size * FLOAT_BYTES;
        }

        for (const [name, value] of this.floatUniforms) {
            const location = gl.getUniformLocation(this.program, name);

            if (location === null) {
                throw new Error(
                    `Uniform "${name}" not found in shader.`
                );
            }

            gl.uniform1f(location, value);
        }

        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.drawArrays(mode, 0, this.vertexCount);

        this.lastDrawMode = mode;
    }

    #createShader(type, source, lineOffset = 0) {
        const gl = this.gl;

        const shader = gl.createShader(type);

        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error(
                lineOffset
                    ? `${log}\n(${lineOffset} lines of shared prelude were ` +
                      `prepended; subtract that from the reported line numbers)`
                    : log
            );
        }

        return shader;
    }
    set textureData(source) {
        const gl = this.gl;

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);

        gl.pixelStorei(
            gl.UNPACK_FLIP_Y_WEBGL,
            true
        );

        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.SRGB8_ALPHA8,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            source
        );

        gl.texParameteri(
            gl.TEXTURE_2D,
            gl.TEXTURE_WRAP_S,
            gl.CLAMP_TO_EDGE
        );

        gl.texParameteri(
            gl.TEXTURE_2D,
            gl.TEXTURE_WRAP_T,
            gl.CLAMP_TO_EDGE
        );

        gl.texParameteri(
            gl.TEXTURE_2D,
            gl.TEXTURE_MIN_FILTER,
            gl.LINEAR
        );

        gl.texParameteri(
            gl.TEXTURE_2D,
            gl.TEXTURE_MAG_FILTER,
            gl.LINEAR
        );
    }

    #createProgram(vertexSource, fragmentSource) {
        const gl = this.gl;

        const vertexShader = this.#createShader(
            gl.VERTEX_SHADER,
            vertexSource
        );

        const fragmentShader = this.#createShader(
            gl.FRAGMENT_SHADER,
            withFragmentPrelude(fragmentSource),
            FRAGMENT_PRELUDE_LINES
        );

        const program = gl.createProgram();

        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);

        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const log = gl.getProgramInfoLog(program);
            gl.deleteProgram(program);
            throw new Error(log);
        }

        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);

        return program;
    }
}

customElements.define("opengl-canvas", OpenGLCanvas);
