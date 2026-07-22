varying vec2 vUv;
varying vec3 vColor;
varying float vIsAnswer;
varying float vHover;

void main() {
  // Soft-edged round dot in its warm color.
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float alpha = smoothstep(0.5, 0.42, d);

  vec3 col = vColor;
  if (vIsAnswer > 0.5) {
    // Answer dots get a slight outline: a bolder (darker) version of their own
    // color around the rim, so they read as distinct, clickable answers.
    vec3 outline = vColor * 0.55;
    float ring = smoothstep(0.33, 0.40, d);
    col = mix(vColor, outline, ring);
  }

  // Hovered dot glows by intensifying its OWN color (not washing to white), so
  // it lights up without looking faded. vHover eases 0..1 with the growth.
  col *= (1.0 + 0.6 * vHover);
  col = min(col, vec3(1.0));

  gl_FragColor = vec4(col, alpha);
}
