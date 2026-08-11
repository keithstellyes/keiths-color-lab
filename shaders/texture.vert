#version 300 es
precision mediump float;

layout(location = 0) in vec2 pos;

out vec2 fragUV;

void main()
{
    vec2 uv = vec2((pos.x + 1.0) / 2.0, (pos.y + 1.0) / 2.0);
    fragUV = uv;
    gl_Position = vec4(pos, 0.0, 1.0);
}
