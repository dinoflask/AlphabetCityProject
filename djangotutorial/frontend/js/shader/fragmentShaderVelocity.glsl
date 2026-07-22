uniform float time;
uniform sampler2D uTarget;
	void main() {
		vec2 uv = gl_FragCoord.xy / resolution.xy;
		vec3 position = texture2D( texturePosition, uv ).xyz;
		vec3 velocity = texture2D( textureVelocity, uv ).xyz;
        vec3 target = texture2D(uTarget, uv ).xyz;

        velocity *= 0.85;
        velocity += (target-position) * 2.;


		gl_FragColor = vec4( velocity, 1.0 );

	}