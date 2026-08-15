#version 300 es

in vec2 fragUV;

uniform sampler2D u_texture;

out vec4 FragColor;

void main()
{
    vec4 sampled = texture(u_texture, fragUV);

    // Threshold each channel at its perceptual midpoint. Cutting linear
    // light at 0.5 would sit up at sRGB 0.735 and lose most of the image
    // to black.
    vec3 encoded = linearToSrgb(sampled.rgb);

    float r = encoded.r >= 0.5 ? 1.0 : 0.0;
    float g = encoded.g >= 0.5 ? 1.0 : 0.0;
    float b = encoded.b >= 0.5 ? 1.0 : 0.0;

    FragColor = vec4(r, g, b, 1.0);
}
