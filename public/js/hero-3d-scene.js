/**
 * Minimalist 3D Fluid Ribbon Editorial Scene
 * (Optimized for Light & Dark Modes with Continuous Undulating Wave & Parallax)
 * 
 * 1. 3D Ribbon Mesh:
 *    - Single continuous curved ribbon sweeping diagonally across the viewport (top-left to bottom-right).
 *    - 200 length segments x 24 width segments (subdivisions > 128) for silky smoothness.
 *    - Smooth vertex normals and pointer-events: none.
 * 2. Materials & Lighting:
 *    - LIGHT THEME:
 *      * ClearColor: #FAF8F5 (warm editorial off-white)
 *      * MeshPhysicalMaterial: color #F2EFE9, roughness 0.55, metalness 0.05, clearcoat 0.15, transmission 0.1
 *      * Sunlight from top-right (color #FFFDF8, intensity 1.5), warm ambient fill (intensity 0.7)
 *    - DARK THEME:
 *      * ClearColor: #0D0D10 (deep obsidian charcoal)
 *      * MeshPhysicalMaterial: color #1C1D22, roughness 0.45, metalness 0.25, clearcoat 0.3, transmission 0.0
 *      * Moody directional rim light (#C8D0E0, intensity 1.6), warm amber bounce (#E0A355, intensity 0.4)
 * 3. Motion & Parallax:
 *    - Slow-motion undulating wave (speed ~0.4) like drifting silk.
 *    - Mouse-reactive parallax tilting camera/ribbon by ±2.5° via MathUtils.lerp.
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

        // --- 1. CONTINUOUS UNDULATING CURVED RIBBON GEOMETRY ---
        // CatmullRom spline sweeping diagonally across viewport from top-left to bottom-right
        const splinePoints = [
            new THREE.Vector3(-12.0, 7.5, -3.2),
            new THREE.Vector3(-7.5, 4.8, -1.8),
            new THREE.Vector3(-3.2, 2.2, -0.6),
            new THREE.Vector3(0.5, 0.2, -0.2),
            new THREE.Vector3(4.8, -2.4, 0.4),
            new THREE.Vector3(8.5, -4.8, 1.0),
            new THREE.Vector3(13.0, -7.5, 1.6)
        ];

        const curve = new THREE.CatmullRomCurve3(splinePoints, false, 'centripetal', 0.5);

        const lengthSegments = 220; // 220+ subdivisions along length
        const widthSegments = 24;  // 24 subdivisions across width
        const ribbonWidth = 3.2;   // Width of the silk strip

        // Compute Frenet frames for parallel orientation along the curve
        const frames = curve.computeFrenetFrames(lengthSegments, false);

        // Precompute base unperturbed ribbon vertices & local normal/span vectors
        const totalVerts = (lengthSegments + 1) * (widthSegments + 1);
        const basePositions = new Float32Array(totalVerts * 3);
        const normalDirs = new Float32Array(totalVerts * 3);
        const tCoords = new Float32Array(totalVerts); // normalized t [0..1]
        const uCoords = new Float32Array(totalVerts); // normalized u [-0.5..0.5]

        const indices = [];

        let vIdx = 0;
        for (let i = 0; i <= lengthSegments; i++) {
            const t = i / lengthSegments;
            const P = curve.getPointAt(t);
            const N = frames.normals[i];
            const B = frames.binormals[i];

            // Controlled graceful twist along the diagonal path
            const twistAngle = (t * Math.PI * 1.35) - 0.2;
            const cosTwist = Math.cos(twistAngle);
            const sinTwist = Math.sin(twistAngle);

            // Vector spanning across the ribbon width
            const spanX = B.x * cosTwist + N.x * sinTwist;
            const spanY = B.y * cosTwist + N.y * sinTwist;
            const spanZ = B.z * cosTwist + N.z * sinTwist;

            // Vector perpendicular to ribbon face (surface normal direction)
            const normX = -B.x * sinTwist + N.x * cosTwist;
            const normY = -B.y * sinTwist + N.y * cosTwist;
            const normZ = -B.z * sinTwist + N.z * cosTwist;

            for (let j = 0; j <= widthSegments; j++) {
                const u = (j / widthSegments) - 0.5; // -0.5 to +0.5
                const widthOffset = u * ribbonWidth;

                // Base unperturbed position
                const posX = P.x + spanX * widthOffset;
                const posY = P.y + spanY * widthOffset;
                const posZ = P.z + spanZ * widthOffset;

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

        // --- 2. THEMED MESHPYSICALMATERIAL CONFIGURATION ---
        // Light Theme: color #F2EFE9, roughness 0.55, metalness 0.05, clearcoat 0.15, transmission 0.1
        // Dark Theme: color #1C1D22, roughness 0.45, metalness 0.25, clearcoat 0.3, transmission 0.0
        const ribbonMat = new THREE.MeshPhysicalMaterial({
            color: isInitiallyDark ? 0x1C1D22 : 0xF2EFE9,
            roughness: isInitiallyDark ? 0.45 : 0.55,
            metalness: isInitiallyDark ? 0.25 : 0.05,
            clearcoat: isInitiallyDark ? 0.3 : 0.15,
            clearcoatRoughness: 0.2,
            transmission: isInitiallyDark ? 0.0 : 0.1,
            ior: 1.45,
            side: THREE.DoubleSide
        });

        const ribbonMesh = new THREE.Mesh(ribbonGeom, ribbonMat);
        scene.add(ribbonMesh);

        // --- 3. DYNAMIC LIGHTING STATES ---
        // Light Mode: Sunlight from top-right (#FFFDF8, 1.5) + warm ambient fill (0.7)
        // Dark Mode: Rim light (#C8D0E0, 1.6) + warm amber bounce (#E0A355, 0.4) + ambient (0.35)

        const ambientLight = new THREE.AmbientLight(
            isInitiallyDark ? 0x0D0D10 : 0xFAF8F5,
            isInitiallyDark ? 0.35 : 0.7
        );
        scene.add(ambientLight);

        // Primary Sun / Key Light (from top-right)
        const primaryLight = new THREE.DirectionalLight(
            isInitiallyDark ? 0x1E2230 : 0xFFFDF8,
            isInitiallyDark ? 0.2 : 1.5
        );
        primaryLight.position.set(7.5, 8.5, 6.0);
        scene.add(primaryLight);

        // Dark-Mode Grazing Rim Light (grazing crests from top-left)
        const rimLight = new THREE.DirectionalLight(
            0xC8D0E0,
            isInitiallyDark ? 1.6 : 0.0
        );
        rimLight.position.set(-8.0, 6.0, 4.0);
        scene.add(rimLight);

        // Dark-Mode Warm Amber Accent Bounce Light (from lower side)
        const bounceLight = new THREE.DirectionalLight(
            0xE0A355,
            isInitiallyDark ? 0.4 : 0.0
        );
        bounceLight.position.set(4.0, -6.0, 3.0);
        scene.add(bounceLight);

        // Lighting & Material Configurations
        const themeConfigs = {
            light: {
                clearColor: 0xFAF8F5,
                ribbonColor: 0xF2EFE9,
                roughness: 0.55,
                metalness: 0.05,
                clearcoat: 0.15,
                transmission: 0.1,
                ambientColor: 0xFAF8F5,
                ambientIntensity: 0.7,
                primaryColor: 0xFFFDF8,
                primaryIntensity: 1.5,
                rimIntensity: 0.0,
                bounceIntensity: 0.0
            },
            dark: {
                clearColor: 0x0D0D10,
                ribbonColor: 0x1C1D22,
                roughness: 0.45,
                metalness: 0.25,
                clearcoat: 0.3,
                transmission: 0.0,
                ambientColor: 0x0D0D10,
                ambientIntensity: 0.35,
                primaryColor: 0x1E2230,
                primaryIntensity: 0.2,
                rimIntensity: 1.6,
                bounceIntensity: 0.4
            }
        };

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
        // ±2.5 degrees ≈ 0.0436 radians
        const maxTiltY = 0.0436;
        const maxTiltX = 0.0436;

        window.addEventListener('mousemove', (e) => {
            const w = window.innerWidth;
            const h = window.innerHeight;
            mouse.targetX = (e.clientX / w) * 2 - 1;
            mouse.targetY = -(e.clientY / h) * 2 + 1;
        }, { passive: true });

        // --- 6. ANIMATION LOOP (UNDULATING DRIFTING SILK & SMOOTH THEME SYNC) ---
        const clock = new THREE.Clock();
        const curClearColor = new THREE.Color(initialBgColor);

        function animate() {
            requestAnimationFrame(animate);

            const elapsedTime = clock.getElapsedTime();
            // Serene, tranquil slow-motion wave speed (~0.12 for hypnotic drifting silk)
            const waveTime = elapsedTime * 0.12;

            // Parallax interpolation with THREE.MathUtils.lerp
            mouse.x = THREE.MathUtils.lerp(mouse.x, mouse.targetX, 0.035);
            mouse.y = THREE.MathUtils.lerp(mouse.y, mouse.targetY, 0.035);

            if (!prefersReducedMotion) {
                const targetRotX = baseCamRotX - (mouse.y * maxTiltX);
                const targetRotY = baseCamRotY + (mouse.x * maxTiltY);
                camera.rotation.x = THREE.MathUtils.lerp(camera.rotation.x, targetRotX, 0.035);
                camera.rotation.y = THREE.MathUtils.lerp(camera.rotation.y, targetRotY, 0.035);
            }

            // Continuous Serene Undulating Wave on Ribbon Mesh Vertices
            const posArray = ribbonGeom.attributes.position.array;
            for (let v = 0; v < totalVerts; v++) {
                const t = tCoords[v];
                const u = uCoords[v];

                // Gentle, slow-motion organic fluid silk wave
                const wave1 = Math.sin(t * 4.2 - waveTime * 1.8) * 0.40;
                const wave2 = Math.cos(t * 6.5 + u * 2.8 - waveTime * 1.2) * 0.20;
                const wave3 = Math.sin(t * 9.0 - waveTime * 1.5) * 0.06;
                const totalDisplacement = wave1 + wave2 + wave3;

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
            ribbonGeom.computeVertexNormals();

            // Dynamic Theme Sync: Lerp colors, materials, and lights
            const isDark = document.body.classList.contains('dark-mode');
            const targetCfg = isDark ? themeConfigs.dark : themeConfigs.light;

            curClearColor.lerp(new THREE.Color(targetCfg.clearColor), 0.08);
            renderer.setClearColor(curClearColor, 1.0);

            // Material properties
            ribbonMat.color.lerp(new THREE.Color(targetCfg.ribbonColor), 0.08);
            ribbonMat.roughness = THREE.MathUtils.lerp(ribbonMat.roughness, targetCfg.roughness, 0.08);
            ribbonMat.metalness = THREE.MathUtils.lerp(ribbonMat.metalness, targetCfg.metalness, 0.08);
            ribbonMat.clearcoat = THREE.MathUtils.lerp(ribbonMat.clearcoat, targetCfg.clearcoat, 0.08);
            ribbonMat.transmission = THREE.MathUtils.lerp(ribbonMat.transmission, targetCfg.transmission, 0.08);

            // Lights
            ambientLight.color.lerp(new THREE.Color(targetCfg.ambientColor), 0.08);
            ambientLight.intensity = THREE.MathUtils.lerp(ambientLight.intensity, targetCfg.ambientIntensity, 0.08);

            primaryLight.color.lerp(new THREE.Color(targetCfg.primaryColor), 0.08);
            primaryLight.intensity = THREE.MathUtils.lerp(primaryLight.intensity, targetCfg.primaryIntensity, 0.08);

            rimLight.intensity = THREE.MathUtils.lerp(rimLight.intensity, targetCfg.rimIntensity, 0.08);
            bounceLight.intensity = THREE.MathUtils.lerp(bounceLight.intensity, targetCfg.bounceIntensity, 0.08);

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
