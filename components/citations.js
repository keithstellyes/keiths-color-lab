let CITATIONS = [];
class CiteInText extends HTMLElement {
    constructor() {
        super();

        const shadow = this.attachShadow({ mode: "open" });

        const styleEl = document.createElement("style");
        styleEl.innerText = `
            :host {
            }
        `;
        shadow.appendChild(styleEl);
        const spanEl = document.createElement("span");
        CITATIONS.push(this.innerHTML);
        spanEl.innerText = '[' + (this.CITATIONS.length) + ']';
        shadow.appendChild(spanEl);
    }

    connectedCallback() {}
}

customElements.define("cite-intext", CiteInText);

class Bibliography extends HTMLElement {
    constructor() {
        super();
        const shadow = this.attachShadow({ mode: "open" });
        for(let i = 0; i < CITATIONS.length; i++) {
            const pEl = document.createElement("p");

            shadow.appendChild(pEl);
            pEl.innerHTML += '[' + (i + 1) + ']';
            pEl.innerHTML += CITATIONS[i];
            pEl.innerHTML += ',';
        }
    }
    connectedCallback() {
    }
}

customElements.define("cite-biblio", Bibliography);
