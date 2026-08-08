class OpenGLCanvas extends HTMLElement {
    constructor() {
        super();

        const shadow = this.attachShadow({ mode: "open" });

        this.canvas = document.createElement("canvas");
        this.canvas.width = 640;
        this.canvas.height = 480;
        shadow.appendChild(this.canvas);

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
    }

    connectedCallback() {
        this.#loadShaders();
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

        gl.viewport(0, 0, this.canvas.width, this.canvas.height);

        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.drawArrays(mode, 0, this.vertexCount);
    }

    #createShader(type, source) {
        const gl = this.gl;

        const shader = gl.createShader(type);

        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error(log);
        }

        return shader;
    }
    set textureData(source) {
        const gl = this.gl;

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);

        // Images have y=0 at top, but in webgl that is bottom
        gl.pixelStorei(
            gl.UNPACK_FLIP_Y_WEBGL,
            true
        );

        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
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
            fragmentSource
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
