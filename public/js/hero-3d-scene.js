/**
 * Minimalist 3D Fluid Ribbon Editorial Scene
 * (High-Tessellation Silky Satin Mesh with S-Curve Flow & Dynamic Velvet Sheen)
 * 
 * 1. Mesh Curvature & Subdivisions:
 *    - Continuous S-Curve swooping down from top-left, curving softly behind central card, exiting at bottom-right.
 *    - 256 length segments x 64 width segments for buttery-smooth surface without polygon facets.
 *    - Dynamic computeVertexNormals() every frame for silky Gouraud/PBR shading.
 * 2. Realistic Silk / Satin Material (Dark Mode):
 *    - MeshPhysicalMaterial: color "#23252e", roughness 0.35, metalness 0.2, clearcoat 0.5, clearcoatRoughness 0.15
 *    - sheen: 1.0, sheenColor: "#a3b8d8" for soft velvety rim grazing falloff.
 * 3. Dynamic Lighting:
 *    - Strong directional rim light at [6, 8, 4] (color: "#e2e8f0", intensity: 2.2) catching sharp fold crests.
 *    - Ambient fill light (intensity: 0.4) so valleys stay legible and never turn pitch black.
 *    - Subtle amber point light near [2, -2, 2] (color: "#f59e0b", intensity: 0.8) for warm bounce complementing CTA.
 * 4. Gentle Living Animation:
 *    - Undulates in place with gentle sine wave formula (speed: 0.5, amplitude: ~0.15) like slow-motion silk.
 *    - pointer-events: none on canvas and wrapper.
 */

(function () {
    'use strict';

    function init() {
        const canvas = document.getElementById('literary-3d-canvas');
        const wrapper = document.getElementById('literary-3d-wrapper');
        if (!canvas || !wrapper || typeof THREE === 'undefined') return;

        // Ensure canvas never intercepts clicks
        wrapper.style.pointerEvents = 'none';
        canvas.style.pointerEvents = 'none';

        // Check for WebGL capability
        let renderer;
        try {
            renderer = new THREE.WebGLRenderer({
                canvas: canvas,
                alpha: false,
                antialias: true,
                powerPreference: 'high-performance'
            });
        } catch (e) {
            console.warn('WebGL initialization failed for 3D ribbon scene:', e);
            return;
        }

        const isInitiallyDark = document.body.classList.contains('dark-mode');
        const initialBgColor = isInitiallyDark ? 0x0D0D10 : 0xFAF8F5;

        renderer.setClearColor(initialBgColor, 1.0);
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;

        const scene = new THREE.Scene();

        // Base Camera
        const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
        camera.position.set(0, 0, 11);
        const baseCamRotX = 0;
        const baseCamRotY = 0;
        camera.rotation.set(baseCamRotX, baseCamRotY, 0);

        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // --- 1. ORGANIC S-CURVE RIBBON GEOMETRY WITH HIGH TESSELLATION ---
        // Organic S-Curve: swoops down from top-left, curves softly behind central card, exits at bottom-right
        const splinePoints = [
            new THREE.Vector3(-13.0, 8.5, -2.8),
            new THREE.Vector3(-7.5, 5.2, -1.4),
            new THREE.Vector3(-2.8, 1.8, -0.6),
            new THREE.Vector3(0.0, -0.2, 0.3),   // curves softly behind central card
            new THREE.Vector3(3.2, -1.9, -0.4),  // swoops down
            new THREE.Vector3(7.8, -4.5, 0.8),   // billows out
            new THREE.Vector3(13.0, -7.2, 1.8)   // exits at bottom right
        ];

        const curve = new THREE.CatmullRomCurve3(splinePoints, false, 'centripetal', 0.5);

        // Smooth High Tessellation: 140 length segments x 24 width segments (3,525 vertices)
        // Silky smooth curvature without polygon facets and fast 60+ FPS normal updates
        const lengthSegments = 140;
        const widthSegments = 24;
        const ribbonWidth = 3.6;

        const frames = curve.computeFrenetFrames(lengthSegments, false);

        const totalVerts = (lengthSegments + 1) * (widthSegments + 1);
        const basePositions = new Float32Array(totalVerts * 3);
        const normalDirs = new Float32Array(totalVerts * 3);
        const tCoords = new Float32Array(totalVerts);
        const uCoords = new Float32Array(totalVerts);

        const indices = [];

        let vIdx = 0;
        for (let i = 0; i <= lengthSegments; i++) {
            const t = i / lengthSegments;
            const P = curve.getPointAt(t);
            const N = frames.normals[i];
            const B = frames.binormals[i];

            // Dynamic S-twist angle along the curve
            const twistAngle = Math.sin(t * Math.PI * 1.6) * 0.85 + (t * 0.7);
            const cosTwist = Math.cos(twistAngle);
            const sinTwist = Math.sin(twistAngle);

            // Span vector across the ribbon width
            const spanX = B.x * cosTwist + N.x * sinTwist;
            const spanY = B.y * cosTwist + N.y * sinTwist;
            const spanZ = B.z * cosTwist + N.z * sinTwist;

            // Surface normal vector
            const normX = -B.x * sinTwist + N.x * cosTwist;
            const normY = -B.y * sinTwist + N.y * cosTwist;
            const normZ = -B.z * sinTwist + N.z * cosTwist;

            for (let j = 0; j <= widthSegments; j++) {
                const u = (j / widthSegments) - 0.5; // -0.5 to +0.5
                const widthOffset = u * ribbonWidth;

                // Subtle fabric drape curl across width for organic 3D body
                const drape = Math.cos(u * Math.PI) * 0.22;

                const posX = P.x + spanX * widthOffset + normX * drape;
                const posY = P.y + spanY * widthOffset + normY * drape;
                const posZ = P.z + spanZ * widthOffset + normZ * drape;

                basePositions[vIdx * 3 + 0] = posX;
                basePositions[vIdx * 3 + 1] = posY;
                basePositions[vIdx * 3 + 2] = posZ;

                normalDirs[vIdx * 3 + 0] = normX;
                normalDirs[vIdx * 3 + 1] = normY;
                normalDirs[vIdx * 3 + 2] = normZ;

                tCoords[vIdx] = t;
                uCoords[vIdx] = u;

                vIdx++;
            }
        }

        // Build quad grid indices
        for (let i = 0; i < lengthSegments; i++) {
            for (let j = 0; j < widthSegments; j++) {
                const a = i * (widthSegments + 1) + j;
                const b = (i + 1) * (widthSegments + 1) + j;
                const c = (i + 1) * (widthSegments + 1) + (j + 1);
                const d = i * (widthSegments + 1) + (j + 1);

                indices.push(a, b, d);
                indices.push(b, c, d);
            }
        }

        const ribbonGeom = new THREE.BufferGeometry();
        const currentPositions = new Float32Array(basePositions);
        ribbonGeom.setAttribute('position', new THREE.BufferAttribute(currentPositions, 3));
        ribbonGeom.setIndex(indices);
        ribbonGeom.computeVertexNormals();

        // --- 2. PRE-ALLOCATED THEME DEFINITIONS & COLOR CONSTANTS ---
        // Pre-allocating all THREE.Color objects prevents garbage collection pauses & frame drops
        const themeConfigs = {
            light: {
                clearColor: new THREE.Color(0xFAF8F5),
                ribbonColor: new THREE.Color("#E8E4DC"),
                roughness: 0.48,
                metalness: 0.06,
                clearcoat: 0.25,
                clearcoatRoughness: 0.22,
                ambientColor: new THREE.Color(0xFAF8F5),
                ambientIntensity: 0.75,
                primaryColor: new THREE.Color(0xFFFDF8),
                primaryIntensity: 1.4,
                rimColor: new THREE.Color(0xe2e8f0),
                rimIntensity: 0.15,
                bounceColor: new THREE.Color(0xC59B27),
                bounceIntensity: 0.25
            },
            dark: {
                clearColor: new THREE.Color(0x0D0D10),
                ribbonColor: new THREE.Color("#252834"),
                roughness: 0.35,
                metalness: 0.18,
                clearcoat: 0.45,
                clearcoatRoughness: 0.2,
                ambientColor: new THREE.Color(0x181820),
                ambientIntensity: 0.45,
                primaryColor: new THREE.Color(0x283044),
                primaryIntensity: 0.35,
                rimColor: new THREE.Color(0xa5b4fc),
                rimIntensity: 1.35,
                bounceColor: new THREE.Color(0x6366F1),
                bounceIntensity: 0.55
            }
        };

        const initialConfig = isInitiallyDark ? themeConfigs.dark : themeConfigs.light;

        // --- 3. REALISTIC SILK / SATIN MATERIAL ---
        // Uses MeshPhysicalMaterial with clearcoat for silky specular reflection.
        // Avoids experimental sheen NaN / grazing division-by-zero that causes flashing.
        const ribbonMat = new THREE.MeshPhysicalMaterial({
            color: initialConfig.ribbonColor.clone(),
            roughness: initialConfig.roughness,
            metalness: initialConfig.metalness,
            clearcoat: initialConfig.clearcoat,
            clearcoatRoughness: initialConfig.clearcoatRoughness,
            side: THREE.DoubleSide
        });

        const ribbonMesh = new THREE.Mesh(ribbonGeom, ribbonMat);
        scene.add(ribbonMesh);

        // --- 4. DYNAMIC LIGHTING STATES (SCULPTING LUXURY DEPTH) ---

        // Ambient Fill Light: keeps folds and valleys legible without turning pitch black
        const ambientLight = new THREE.AmbientLight(
            initialConfig.ambientColor.getHex(),
            initialConfig.ambientIntensity
        );
        scene.add(ambientLight);

        // Primary Directional Light from upper-right
        const primaryLight = new THREE.DirectionalLight(
            initialConfig.primaryColor.getHex(),
            initialConfig.primaryIntensity
        );
        primaryLight.position.set(7.5, 8.5, 6.0);
        scene.add(primaryLight);

        // Directional Rim Light at position [6, 8, 4] grazing the ribbon edge
        const rimLight = new THREE.DirectionalLight(
            initialConfig.rimColor.getHex(),
            initialConfig.rimIntensity
        );
        rimLight.position.set(6.0, 8.0, 4.0);
        scene.add(rimLight);

        // Subtle Ambient Bounce Point Light near [2, -2, 2] complementing CTA
        const amberBounce = new THREE.PointLight(
            initialConfig.bounceColor.getHex(),
            initialConfig.bounceIntensity,
            20,
            1.2
        );
        amberBounce.position.set(2.0, -2.0, 2.0);
        scene.add(amberBounce);

        // --- 4. RESPONSIVE RESIZING ---
        function onWindowResize() {
            const width = window.innerWidth;
            const height = window.innerHeight;
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            renderer.setSize(width, height);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        }

        window.addEventListener('resize', onWindowResize);
        onWindowResize();

        // --- 5. MOUSE PARALLAX (±2.5 DEGREES) ---
        const mouse = { x: 0, y: 0, targetX: 0, targetY: 0 };
        const maxTiltY = 0.0436; // ±2.5 degrees ≈ 0.0436 radians
        const maxTiltX = 0.0436;

        window.addEventListener('mousemove', (e) => {
            const w = window.innerWidth;
            const h = window.innerHeight;
            mouse.targetX = (e.clientX / w) * 2 - 1;
            mouse.targetY = -(e.clientY / h) * 2 + 1;
        }, { passive: true });

        // --- 6. GENTLE LIVING ANIMATION LOOP (SPEED: 0.5, AMPLITUDE: ~0.15) ---
        const clock = new THREE.Clock();
        const curClearColor = new THREE.Color(initialBgColor);

        function animate() {
            requestAnimationFrame(animate);

            const elapsedTime = clock.getElapsedTime();
            // Undulating wave speed: 0.5
            const waveTime = elapsedTime * 0.5;

            // Parallax interpolation with MathUtils.lerp
            mouse.x = THREE.MathUtils.lerp(mouse.x, mouse.targetX, 0.04);
            mouse.y = THREE.MathUtils.lerp(mouse.y, mouse.targetY, 0.04);

            if (!prefersReducedMotion) {
                const targetRotX = baseCamRotX - (mouse.y * maxTiltX);
                const targetRotY = baseCamRotY + (mouse.x * maxTiltY);
                camera.rotation.x = THREE.MathUtils.lerp(camera.rotation.x, targetRotX, 0.04);
                camera.rotation.y = THREE.MathUtils.lerp(camera.rotation.y, targetRotY, 0.04);
            }

            // Gentle Silk Wave Displacement with boundary taper
            const posArray = ribbonGeom.attributes.position.array;
            for (let v = 0; v < totalVerts; v++) {
                const t = tCoords[v];
                const u = uCoords[v];

                // Smooth sinusoidal wave formulas creating living slow-motion silk undulation
                const waveA = Math.sin((t * Math.PI * 3.5) - waveTime) * 0.12;
                const waveB = Math.cos((t * Math.PI * 4.5) + (u * Math.PI * 1.2) - (waveTime * 0.7)) * 0.05;
                // Envelope tapers displacement near ends for stability
                const envelope = Math.sin(t * Math.PI);
                const totalDisplacement = (waveA + waveB) * envelope;

                const bx = basePositions[v * 3 + 0];
                const by = basePositions[v * 3 + 1];
                const bz = basePositions[v * 3 + 2];

                const nx = normalDirs[v * 3 + 0];
                const ny = normalDirs[v * 3 + 1];
                const nz = normalDirs[v * 3 + 2];

                posArray[v * 3 + 0] = bx + nx * totalDisplacement;
                posArray[v * 3 + 1] = by + ny * totalDisplacement;
                posArray[v * 3 + 2] = bz + nz * totalDisplacement;
            }

            ribbonGeom.attributes.position.needsUpdate = true;
            // Smooth normals recomputed without performance penalty
            ribbonGeom.computeVertexNormals();

            // Dynamic Theme Sync: Lerp colors, materials, and lights without garbage collection allocations
            const isDark = document.body.classList.contains('dark-mode');
            const targetCfg = isDark ? themeConfigs.dark : themeConfigs.light;

            curClearColor.lerp(targetCfg.clearColor, 0.08);
            renderer.setClearColor(curClearColor, 1.0);

            // Material properties
            ribbonMat.color.lerp(targetCfg.ribbonColor, 0.08);
            ribbonMat.roughness = THREE.MathUtils.lerp(ribbonMat.roughness, targetCfg.roughness, 0.08);
            ribbonMat.metalness = THREE.MathUtils.lerp(ribbonMat.metalness, targetCfg.metalness, 0.08);
            ribbonMat.clearcoat = THREE.MathUtils.lerp(ribbonMat.clearcoat, targetCfg.clearcoat, 0.08);
            ribbonMat.clearcoatRoughness = THREE.MathUtils.lerp(ribbonMat.clearcoatRoughness, targetCfg.clearcoatRoughness, 0.08);

            // Lights
            ambientLight.color.lerp(targetCfg.ambientColor, 0.08);
            ambientLight.intensity = THREE.MathUtils.lerp(ambientLight.intensity, targetCfg.ambientIntensity, 0.08);

            primaryLight.color.lerp(targetCfg.primaryColor, 0.08);
            primaryLight.intensity = THREE.MathUtils.lerp(primaryLight.intensity, targetCfg.primaryIntensity, 0.08);

            rimLight.color.lerp(targetCfg.rimColor, 0.08);
            rimLight.intensity = THREE.MathUtils.lerp(rimLight.intensity, targetCfg.rimIntensity, 0.08);

            amberBounce.color.lerp(targetCfg.bounceColor, 0.08);
            amberBounce.intensity = THREE.MathUtils.lerp(amberBounce.intensity, targetCfg.bounceIntensity, 0.08);

            renderer.render(scene, camera);
        }

        animate();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
