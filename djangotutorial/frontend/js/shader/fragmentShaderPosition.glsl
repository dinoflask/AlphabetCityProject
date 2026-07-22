uniform float time;
uniform float delta;
#include noise.glsl

void main()	{
    float uTime = time*0.1;
	vec2 uv = gl_FragCoord.xy / resolution.xy;
	vec3 position = texture2D( texturePosition, uv ).xyz; 
	vec3 velocity = texture2D( textureVelocity, uv ).xyz;

    position.xyz += velocity.xyz * 1./60.;

    vec4 rands = hash43(vec3(uv*10., 0.));

    position.xyz += curl(vec3(position.xy, rands.x), uTime, 0.1)*0.001*smoothstep(0.1,0.5,rands.z);

	gl_FragColor = vec4( position + velocity*0., 1. );

}