#version 300 es
precision mediump float;

layout(location = 0) in vec2 pos;
layout(location = 1) in vec2 uv;

out vec2 fragUV;

void main()
{
    fragUV = uv;
    gl_Position = vec4(pos, 0.0, 1.0);
}
