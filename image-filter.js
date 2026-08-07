class ImageFilter extends HTMLElement {
  constructor() {
    super(); // Always call super() first to establish the prototype chain

    // Attach a shadow DOM to encapsulate your component styles and markup
    this.attachShadow({ mode: 'open' });
  }

  // Runs automatically when the element is added to the webpage
  connectedCallback() {
    const title = this.getAttribute('title') || '';

    this.shadowRoot.innerHTML = `
      <style>
        .image-filter-div {
          border-radius: 5px;
          border: 5px solid #0076ff;
        }
        h3 { color: #333; margin: 0 0 10px 0; }
      </style>
      <div class="image-filter-div">
          <h1>${title}</h1>
          <canvas>
          </canvas>
      </div>
    `;
  }
}

// Register the custom element tag with the browser
customElements.define('image-filter', ImageFilter);

