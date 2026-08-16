class ImageFilter extends OpenGLCanvas {
    constructor() {
        super();

        this.addEventListener("ready", () => {
            this.vertexData = {
                data: [
                    -1, -1,
                    1, -1,
                    -1,  1,

                    -1,  1,
                    1, -1,
                    1,  1
                ],

                attributes: [
                    { name: "pos", size: 2 }
                ]
            };
        });
        const styleElement = document.createElement("style");
        styleElement.innerText = `
            @import url('https://googleapis.com');
            :host {
                /*display: inline-block;*/
                display: flex;
                flex-direction: column;
                border: 1px solid black;
                background-color: white;
                /* https://www.template.net/graphic-design/polaroid-sizes/ */
                height: 420px;
                width: 350px;
                flex-shrink: 0;
                gap: 0;
            }
            canvas {
                cursor: pointer;
                flex: none;
                align-self: center;
                margin-top: 11px;
            }

            h1 {
              font-family: 'Kalam', cursive;
              font-weight: 700;
              /* distance between edge and start of photo proper*/
              margin-left: 40px;
            }
            #imageInput {
                display: none;
            }
                    `;
        this.shadowRoot.appendChild(styleElement);

        const uploadable = !this.hasAttribute("no-upload");

        this.titleEl = document.createElement("h1");
        this.titleEl.innerText = this.getAttribute("title")
            || (uploadable ? "Click to upload image" : "");
        this.shadowRoot.append(this.titleEl);

        if (!uploadable) {
            this.canvas.style.cursor = "default";
            return;
        }

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
            const stripped = file.name.indexOf('.') == -1
                ? file.name
                : file.name.substr(0, file.name.indexOf('.'));
            this.setTitle(stripped);
            const image = new Image();
            image.src = URL.createObjectURL(file);
            await image.decode();
            this.setImage(image);

            this.dispatchEvent(new CustomEvent("image", { detail: image }));
            URL.revokeObjectURL(image.src);

            // So picking the same file twice still fires "change"
            imageInput.value = "";
        });

    }
    setTitle(title) {
        this.titleEl.innerText = title;
    }

    setImage(image) {
        this.textureData = image;

        if (this.ready) {
            this.draw();
        } else {
            this.addEventListener("ready", () => this.draw(), { once: true });
        }
    }
    connectedCallback() {
        super.connectedCallback();
    }
}

customElements.define('image-filter', ImageFilter);
