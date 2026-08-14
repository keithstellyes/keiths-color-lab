#version 300 es
precision mediump float;

in vec2 fragUV;

uniform sampler2D u_texture;

out vec4 FragColor;

void main()
{
    vec4 sampled = texture(u_texture, fragUV);
    sampled.r *= 0.2627;
    sampled.g *= 0.6780;
    sampled.b *= 0.0593;
    float y = (sampled.r + sampled.g + sampled.b) / 3.0;
    y = y > 0.5 ? 1.0 : 0.0;
    FragColor = vec4(y, y, y, 1.0);
}
