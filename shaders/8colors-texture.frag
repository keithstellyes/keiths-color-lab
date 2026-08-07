#version 300 es
precision mediump float;

in vec2 fragUV;

uniform sampler2D u_texture;

out vec4 FragColor;

void main()
{
    vec4 sampledColor = texture(u_texture, fragUV);
    float r = sampledColor.r >= 0.5 ? 1.0 : 0.0;
    float g = sampledColor.g >= 0.5 ? 1.0 : 0.0;
    float b = sampledColor.b >= 0.5 ? 1.0 : 0.0;
    FragColor = vec4(r, g, b, 1.0);
}
