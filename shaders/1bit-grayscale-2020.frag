#version 300 es
precision mediump float;

in vec2 fragUV;

uniform sampler2D u_texture;

out vec4 FragColor;

void main()
{
    vec4 sampled = texture(u_texture, fragUV);
    // ITU-R Rec. 2020 luma coefficients; they sum to 1.0, so this is
    // already a weighted average -- no divide afterwards.
    float y = dot(sampled.rgb, vec3(0.2627, 0.6780, 0.0593));
    y = y > 0.5 ? 1.0 : 0.0;
    FragColor = vec4(y, y, y, 1.0);
}
