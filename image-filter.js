class ImageFilter extends OpenGLCanvas {
    constructor() {
        super();

        this.addEventListener("ready", () => {
            this.vertexData = {
                data: [
                    // position    // UV
                    -1, -1,         0, 0,
                    1, -1,         1, 0,
                    -1,  1,         0, 1,

                    -1,  1,         0, 1,
                    1, -1,         1, 0,
                    1,  1,         1, 1
                ],

                attributes: [
                    { name: "pos", size: 2 },
                    { name: "uv", size: 2 }
                ]
            };
        });
        const styleElement = document.createElement("style");
        styleElement.innerText = `
            :host {
                display: inline-block;
                border: 1px solid black;
            }

            canvas {
                cursor: pointer;
            }

            #imageInput {
                display: none;
            }
                    `;
        this.shadowRoot.appendChild(styleElement);
        const imageInput = document.createElement("input");
        imageInput.id = "imageInput";
        imageInput.type = "file";
        imageInput.accept = "image/*";
        this.shadowRoot.prepend(imageInput);

        this.canvas.title = "Click to choose an image";
        this.canvas.addEventListener("click", () => imageInput.click());

        imageInput.addEventListener("change", async () => {
            const file = imageInput.files[0];

            if (!file) {
                return;
            }

            const image = new Image();

            image.src = URL.createObjectURL(file);

            await image.decode();

            this.textureData = image;

            this.draw();

            URL.revokeObjectURL(image.src);

            // So picking the same file twice still fires "change"
            imageInput.value = "";
        });

    }
    connectedCallback() {
        super.connectedCallback();
    }
}

customElements.define('image-filter', ImageFilter);
