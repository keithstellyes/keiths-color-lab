class NextPage extends HTMLElement {
    constructor() {
        super();

        const shadow = this.attachShadow({ mode: "open" });

        const styleEl = document.createElement("style");
        styleEl.innerText = `
            :host {
            }
        `;
        shadow.appendChild(styleEl);
        const aEl = document.createElement("a");
        aEl.setAttribute("href", this.textContent.trim());
        aEl.innerText = "NEXT";
        shadow.appendChild(aEl);
    }

    connectedCallback() {}
}

customElements.define("next-page", NextPage);

