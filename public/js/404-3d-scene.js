/**
 * Miniblogs 404 Endless Möbius Ribbon Scene
 * (Panoramic 3D Lemniscate Silk Ribbon with 360° Continuous Möbius Twist & Mouse Parallax)
 */
(function () {
    'use strict';

    function initEndlessRibbonScene() {
        const canvas = document.getElementById('error-3d-canvas');
        const wrapper = document.getElementById('error-3d-wrapper');
        if (!canvas || !wrapper) {
            console.warn('[404 3D] Canvas or wrapper not found in DOM.');
            return;
        }

        if (typeof THREE === 'undefined') {
            console.error('[404 3D] THREE is not loaded.');
            return;
        }

        wrapper.style.pointerEvents = 'none';
        canvas.style.pointerEvents = 'none';

        let renderer;
        try {
            renderer = new THREE.WebGLRenderer({
                canvas: canvas,
                alpha: false,
                antialias: true,
                powerPreference: 'high-performance'
            });
        } catch (e) {
            console.warn('[404 3D] WebGL initialization failed:', e);
            return;
        }

        const isInitiallyDark = document.body.classList.contains('dark-mode');
        const initialBgColor = isInitiallyDark ? 0x0D0D10 : 0xFAF8F5;

        renderer.setClearColor(initialBgColor, 1.0);
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.15;

        const scene = new THREE.Scene();

        // Camera setup: centered, framed to sweep into wide margins
        const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
        camera.position.set(0, 0, window.innerWidth < 768 ? 16.5 : 12.8);
        camera.lookAt(0, 0, 0);

        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // --- 1. PARAMETRIC 3D LEMNISCATE (EXPANDED TO SWEEP ACROSS FULL SCREEN) ---
        const sampleCount = 120;
        const curvePoints = [];
        const scaleX = 13.5; // Sweeps wide into empty left & right margins
        const scaleY = 7.2;  // Sweeps comfortably above and below center card
        const scaleZ = 3.8;  // Deep 3D undulating curve

        for (let i = 0; i < sampleCount; i++) {
            const u = (i / sampleCount) * Math.PI * 2;
            const x = scaleX * Math.sin(u);
            const y = (scaleY * 0.5) * Math.sin(2 * u);
            const z = scaleZ * Math.cos(u);

            // Diagonal tilt for elegant dynamic framing
            const tiltAngle = 0.22;
            const tiltedY = y * Math.cos(tiltAngle) - z * Math.sin(tiltAngle);
            const tiltedZ = y * Math.sin(tiltAngle) + z * Math.cos(tiltAngle);

            curvePoints.push(new THREE.Vector3(x, tiltedY, tiltedZ));
        }

        const curve = new THREE.CatmullRomCurve3(curvePoints, true, 'centripetal', 0.5);

        // --- 2. RIBBON MESH GENERATION (FRENET FRAMES & 360° MÖBIUS TWIST) ---
        const lengthSegments = 160;
        const widthSegments = 24;
        const ribbonWidth = 3.6;

        const frames = curve.computeFrenetFrames(lengthSegments, true);
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
            const N = frames.normals[i % lengthSegments];
            const B = frames.binormals[i % lengthSegments];

            // 360-degree continuous twist along the closed loop (Möbius topology)
            const twistAngle = t * Math.PI * 2;
            const cosTwist = Math.cos(twistAngle);
            const sinTwist = Math.sin(twistAngle);

            const spanX = B.x * cosTwist + N.x * sinTwist;
            const spanY = B.y * cosTwist + N.y * sinTwist;
            const spanZ = B.z * cosTwist + N.z * sinTwist;

            const normX = -B.x * sinTwist + N.x * cosTwist;
            const normY = -B.y * sinTwist + N.y * cosTwist;
            const normZ = -B.z * sinTwist + N.z * cosTwist;

            for (let j = 0; j <= widthSegments; j++) {
                const u = (j / widthSegments) - 0.5; // -0.5 to +0.5
                const widthOffset = u * ribbonWidth;
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

        // Triangulate ribbon grid
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
        ribbonGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(basePositions), 3));
        ribbonGeom.setIndex(indices);
        ribbonGeom.computeVertexNormals();

        // --- 3. LUXURY SILK MATERIAL & PBR PROPERTIES ---
        const themeConfigs = {
            dark: {
                clearColor: new THREE.Color(0x0D0D10),
                ribbonColor: new THREE.Color('#2e334a'), // Rich visible obsidian slate silk
                roughness: 0.32,
                metalness: 0.20,
                clearcoat: 0.65,
                clearcoatRoughness: 0.15,
                ambientColor: new THREE.Color(0x222638),
                ambientIntensity: 0.70,
                goldLightColor: new THREE.Color('#f59e0b'),
                goldLightIntensity: 2.6,
                silverLightColor: new THREE.Color('#e2e8f0'),
                silverLightIntensity: 2.8,
                rimLightColor: new THREE.Color('#93c5fd'),
                rimLightIntensity: 1.8
            },
            light: {
                clearColor: new THREE.Color(0xFAF8F5),
                ribbonColor: new THREE.Color('#dcd7ce'), // Soft ivory champagne satin
                roughness: 0.35,
                metalness: 0.10,
                clearcoat: 0.50,
                clearcoatRoughness: 0.20,
                ambientColor: new THREE.Color(0xfff8ee),
                ambientIntensity: 0.90,
                goldLightColor: new THREE.Color('#d97706'),
                goldLightIntensity: 1.8,
                silverLightColor: new THREE.Color(0xffffff),
                silverLightIntensity: 2.0,
                rimLightColor: new THREE.Color(0xd4d4d8),
                rimLightIntensity: 0.9
            }
        };

        const activeCfg = isInitiallyDark ? themeConfigs.dark : themeConfigs.light;

        const ribbonMat = new THREE.MeshPhysicalMaterial({
            color: activeCfg.ribbonColor.clone(),
            roughness: activeCfg.roughness,
            metalness: activeCfg.metalness,
            clearcoat: activeCfg.clearcoat,
            clearcoatRoughness: activeCfg.clearcoatRoughness,
            side: THREE.DoubleSide
        });

        const ribbonMesh = new THREE.Mesh(ribbonGeom, ribbonMat);
        ribbonMesh.position.set(0, 0, -1.5);
        scene.add(ribbonMesh);

        // --- 4. HIGH-END STUDIO LIGHTING ---
        const ambientLight = new THREE.AmbientLight(activeCfg.ambientColor, activeCfg.ambientIntensity);
        scene.add(ambientLight);

        // Warm Golden PointLight glowing upward from below card
        const goldPointLight = new THREE.PointLight(activeCfg.goldLightColor, activeCfg.goldLightIntensity, 35, 1.0);
        goldPointLight.position.set(0, -3.2, 3.5);
        scene.add(goldPointLight);

        // Cool Silver DirectionalLight catching crests of the twisting Möbius loop
        const silverKeyLight = new THREE.DirectionalLight(activeCfg.silverLightColor, activeCfg.silverLightIntensity);
        silverKeyLight.position.set(6, 8, 5);
        scene.add(silverKeyLight);

        // Soft Opposing Cyan/Silver Rim Light
        const rimLight = new THREE.DirectionalLight(activeCfg.rimLightColor, activeCfg.rimLightIntensity);
        rimLight.position.set(-6, -4, 2);
        scene.add(rimLight);

        // --- 5. PARALLAX & MOUSE INTERACTION ---
        const mouse = { x: 0, y: 0, targetX: 0, targetY: 0 };
        const maxTiltX = 0.08;
        const maxTiltY = 0.12;

        function onPointerMove(e) {
            if (prefersReducedMotion) return;
            const w = window.innerWidth;
            const h = window.innerHeight;
            mouse.targetX = (e.clientX / w) * 2 - 1;
            mouse.targetY = -(e.clientY / h) * 2 + 1;
        }
        window.addEventListener('pointermove', onPointerMove, { passive: true });

        // --- 6. RESIZE HANDLER ---
        function onResize() {
            if (!canvas) return;
            const w = window.innerWidth;
            const h = window.innerHeight;
            if (w === 0 || h === 0) return;
            camera.aspect = w / h;
            camera.position.z = w < 768 ? 16.5 : 12.8;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        }
        window.addEventListener('resize', onResize);

        // --- 7. ANIMATION LOOP ---
        const clock = new THREE.Clock();
        const posAttr = ribbonGeom.attributes.position;
        const curClearColor = (initialBgColor === 0x0D0D10 ? themeConfigs.dark.clearColor : themeConfigs.light.clearColor).clone();

        function animate() {
            requestAnimationFrame(animate);

            const elapsedTime = clock.getElapsedTime();
            const waveTime = elapsedTime * 0.65;

            // Smooth mouse parallax
            mouse.x = THREE.MathUtils.lerp(mouse.x, mouse.targetX, 0.06);
            mouse.y = THREE.MathUtils.lerp(mouse.y, mouse.targetY, 0.06);

            if (!prefersReducedMotion) {
                camera.rotation.x = THREE.MathUtils.lerp(camera.rotation.x, -mouse.y * maxTiltX, 0.06);
                camera.rotation.y = THREE.MathUtils.lerp(camera.rotation.y, mouse.x * maxTiltY, 0.06);
            }

            // Continuous travelling wave along the endless loop
            const posArray = posAttr.array;
            for (let i = 0; i < totalVerts; i++) {
                const t = tCoords[i];
                const u = uCoords[i];

                // Smooth harmonic traveling sine waves
                const wave1 = Math.sin(t * Math.PI * 4 - waveTime + u * Math.PI * 2) * 0.14;
                const wave2 = Math.cos(t * Math.PI * 6 + waveTime * 0.5) * 0.07;
                const waveDisplacement = wave1 + wave2;

                const normX = normalDirs[i * 3 + 0];
                const normY = normalDirs[i * 3 + 1];
                const normZ = normalDirs[i * 3 + 2];

                posArray[i * 3 + 0] = basePositions[i * 3 + 0] + normX * waveDisplacement;
                posArray[i * 3 + 1] = basePositions[i * 3 + 1] + normY * waveDisplacement;
                posArray[i * 3 + 2] = basePositions[i * 3 + 2] + normZ * waveDisplacement;
            }
            posAttr.needsUpdate = true;
            ribbonGeom.computeVertexNormals();

            // Whole loop gentle breathing rotation
            ribbonMesh.rotation.y = Math.sin(elapsedTime * 0.25) * 0.10;
            ribbonMesh.rotation.x = Math.cos(elapsedTime * 0.20) * 0.06;
            ribbonMesh.position.y = Math.sin(elapsedTime * 0.40) * 0.14;

            // Dynamic theme transition
            const isDark = document.body.classList.contains('dark-mode');
            const targetCfg = isDark ? themeConfigs.dark : themeConfigs.light;

            curClearColor.lerp(targetCfg.clearColor, 0.12);
            renderer.setClearColor(curClearColor, 1.0);

            ribbonMat.color.lerp(targetCfg.ribbonColor, 0.12);
            ribbonMat.roughness = THREE.MathUtils.lerp(ribbonMat.roughness, targetCfg.roughness, 0.12);
            ribbonMat.metalness = THREE.MathUtils.lerp(ribbonMat.metalness, targetCfg.metalness, 0.12);
            ribbonMat.clearcoat = THREE.MathUtils.lerp(ribbonMat.clearcoat, targetCfg.clearcoat, 0.12);
            ribbonMat.clearcoatRoughness = THREE.MathUtils.lerp(ribbonMat.clearcoatRoughness, targetCfg.clearcoatRoughness, 0.12);

            ambientLight.color.lerp(targetCfg.ambientColor, 0.12);
            ambientLight.intensity = THREE.MathUtils.lerp(ambientLight.intensity, targetCfg.ambientIntensity, 0.12);

            goldPointLight.color.lerp(targetCfg.goldLightColor, 0.12);
            goldPointLight.intensity = THREE.MathUtils.lerp(goldPointLight.intensity, targetCfg.goldLightIntensity, 0.12);

            silverKeyLight.color.lerp(targetCfg.silverLightColor, 0.12);
            silverKeyLight.intensity = THREE.MathUtils.lerp(silverKeyLight.intensity, targetCfg.silverLightIntensity, 0.12);

            rimLight.color.lerp(targetCfg.rimLightColor, 0.12);
            rimLight.intensity = THREE.MathUtils.lerp(rimLight.intensity, targetCfg.rimLightIntensity, 0.12);

            renderer.render(scene, camera);
        }

        animate();
        setTimeout(onResize, 60);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initEndlessRibbonScene);
    } else {
        initEndlessRibbonScene();
    }
})();
