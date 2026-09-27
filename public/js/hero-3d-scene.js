/**
 * Literary 3D Ambient Side Margins Experience for Miniblogs
 * Built with Three.js
 *
 * Layout & Spacing Rules:
 * 1. Zero collisions: At least 180px-250px vertical clearance between items.
 * 2. Visual Hierarchy: Reduced notebook & book scales by ~18-20% so they frame the hero text.
 * 3. Decoupled Bottom-Right Cluster: Glasses tucked low (-5.0), Book 2 at (-2.2),
 *    Sheet 2 at mid-right (+1.0), Pen at top right (+4.0).
 * 4. Layering & Depth: Distant sheets at Z < -1.5 with opacity 0.80.
 * 5. Organic Floating: Unique 4.5s-7.5s cycle periods and ±3° to ±5° gentle rotation.
 */

(function () {
    'use strict';

    function init() {
        const canvas = document.getElementById('literary-3d-canvas');
        if (!canvas || typeof THREE === 'undefined') {
            setTimeout(init, 100);
            return;
        }

        // Attach wrapper directly to document.body so it acts as a true fixed viewport background
        const wrapper = document.getElementById('literary-3d-wrapper');
        if (wrapper && wrapper.parentElement !== document.body) {
            document.body.appendChild(wrapper);
        }

        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // --- 1. Scene, Camera, Renderer ---
        const scene = new THREE.Scene();

        const camera = new THREE.PerspectiveCamera(
            45,
            window.innerWidth / window.innerHeight,
            0.1,
            100
        );
        camera.position.set(0, 0, 16);
        camera.lookAt(0, 0, 0);

        const renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            alpha: true,
            antialias: true,
            powerPreference: 'high-performance'
        });
        renderer.setClearColor(0x000000, 0); // 100% transparent background
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.35;

        // --- 2. Canvas Textures ---
        function createCoverTexture(title, subtitle, bgColor, goldColor) {
            const c = document.createElement('canvas');
            c.width = 512;
            c.height = 700;
            const ctx = c.getContext('2d');

            const bgGrad = ctx.createLinearGradient(0, 0, 512, 700);
            bgGrad.addColorStop(0, bgColor[0]);
            bgGrad.addColorStop(0.5, bgColor[1]);
            bgGrad.addColorStop(1, bgColor[2]);
            ctx.fillStyle = bgGrad;
            ctx.fillRect(0, 0, 512, 700);

            ctx.fillStyle = 'rgba(0,0,0,0.06)';
            for (let i = 0; i < 3500; i++) {
                ctx.fillRect(Math.random() * 512, Math.random() * 700, 1.5, 1.5);
            }

            ctx.strokeStyle = goldColor;
            ctx.lineWidth = 6;
            ctx.strokeRect(30, 30, 452, 640);
            ctx.lineWidth = 2;
            ctx.strokeRect(40, 40, 432, 620);

            ctx.fillStyle = goldColor;
            ctx.textAlign = 'center';
            ctx.font = 'bold 42px "Lora", Georgia, serif';
            ctx.fillText(title, 256, 260);

            ctx.font = 'italic 22px "Lora", Georgia, serif';
            ctx.fillStyle = 'rgba(235, 210, 145, 0.85)';
            ctx.fillText(subtitle, 256, 314);

            ctx.beginPath();
            ctx.arc(256, 420, 34, 0, Math.PI * 2);
            ctx.strokeStyle = goldColor;
            ctx.lineWidth = 3;
            ctx.stroke();

            ctx.font = '26px "Lora", Georgia, serif';
            ctx.fillStyle = goldColor;
            ctx.fillText('❦', 256, 430);

            const tex = new THREE.CanvasTexture(c);
            tex.anisotropy = 4;
            return tex;
        }

        function createManuscriptTexture() {
            const c = document.createElement('canvas');
            c.width = 512;
            c.height = 700;
            const ctx = c.getContext('2d');

            ctx.fillStyle = '#f8f4ec';
            ctx.fillRect(0, 0, 512, 700);

            ctx.strokeStyle = 'rgba(215, 140, 140, 0.35)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(70, 0);
            ctx.lineTo(70, 700);
            ctx.stroke();

            ctx.strokeStyle = 'rgba(50, 40, 35, 0.35)';
            ctx.lineWidth = 2;
            for (let y = 80; y < 650; y += 26) {
                ctx.beginPath();
                let startX = 85 + Math.random() * 10;
                let endX = 460 - Math.random() * 40;
                ctx.moveTo(startX, y);
                for (let x = startX; x < endX; x += 15) {
                    ctx.lineTo(x, y + (Math.random() - 0.5) * 3);
                }
                ctx.stroke();
            }

            const tex = new THREE.CanvasTexture(c);
            tex.anisotropy = 4;
            return tex;
        }

        // --- 3. Materials ---
        const goldMaterial = new THREE.MeshStandardMaterial({
            color: 0xd4af37,
            metalness: 0.85,
            roughness: 0.25
        });

        const pageEdgeMaterial = new THREE.MeshStandardMaterial({
            color: 0xf5eedb,
            roughness: 0.8,
            metalness: 0.05
        });

        const darkResinMaterial = new THREE.MeshStandardMaterial({
            color: 0x141418,
            roughness: 0.15,
            metalness: 0.35
        });

        const burgundyWaxMaterial = new THREE.MeshStandardMaterial({
            color: 0x7c1a22,
            roughness: 0.45,
            metalness: 0.1
        });

        const glassMaterial = new THREE.MeshPhysicalMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.45,
            roughness: 0.1,
            transmission: 0.9,
            ior: 1.5
        });

        const manuscriptTex = createManuscriptTexture();
        // Background depth-of-field: subtle transparency on distant manuscript sheets
        const manuscriptMat = new THREE.MeshStandardMaterial({
            map: manuscriptTex,
            roughness: 0.9,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.82
        });

        // --- 4. Prop Meshes ---
        function createBookMesh({ width = 2.0, height = 2.8, depth = 0.42, coverTex, spineColor = 0x5a181d }) {
            const bookGroup = new THREE.Group();

            const pagesGeo = new THREE.BoxGeometry(width - 0.1, height - 0.15, depth - 0.08);
            const pagesMesh = new THREE.Mesh(pagesGeo, pageEdgeMaterial);
            pagesMesh.position.x = 0.05;
            bookGroup.add(pagesMesh);

            const spineMat = new THREE.MeshStandardMaterial({ color: spineColor, roughness: 0.45 });
            const frontCoverMat = new THREE.MeshStandardMaterial({ map: coverTex, roughness: 0.4, metalness: 0.2 });
            const backCoverMat = new THREE.MeshStandardMaterial({ color: spineColor, roughness: 0.45 });

            const coverFlapGeo = new THREE.BoxGeometry(width, height, 0.04);
            const frontCover = new THREE.Mesh(coverFlapGeo, frontCoverMat);
            frontCover.position.z = depth / 2;
            bookGroup.add(frontCover);

            const backCover = new THREE.Mesh(coverFlapGeo, backCoverMat);
            backCover.position.z = -depth / 2;
            bookGroup.add(backCover);

            const spineGeo = new THREE.CylinderGeometry(depth / 2, depth / 2, height, 16, 1, false, Math.PI / 2, Math.PI);
            const spineMesh = new THREE.Mesh(spineGeo, spineMat);
            spineMesh.rotation.y = Math.PI / 2;
            spineMesh.position.x = -width / 2;
            bookGroup.add(spineMesh);

            const ribbonGeo = new THREE.PlaneGeometry(0.12, 1.1);
            const ribbonMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, side: THREE.DoubleSide });
            const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat);
            ribbon.position.set(0.08, -height / 2 - 0.35, 0.05);
            ribbon.rotation.z = -0.2;
            ribbon.rotation.x = 0.3;
            bookGroup.add(ribbon);

            return bookGroup;
        }

        function createCurvedSheet() {
            const sheetGeo = new THREE.CylinderGeometry(2.6, 2.6, 2.1, 16, 1, true, 0, Math.PI * 0.35);
            const sheet = new THREE.Mesh(sheetGeo, manuscriptMat);
            sheet.rotation.z = Math.PI / 2;
            return sheet;
        }

        function createWaxSeal() {
            const sealGroup = new THREE.Group();
            const sealGeo = new THREE.CylinderGeometry(0.38, 0.42, 0.08, 18);
            const seal = new THREE.Mesh(sealGeo, burgundyWaxMaterial);
            seal.rotation.x = Math.PI / 2;
            sealGroup.add(seal);

            const ringGeo = new THREE.TorusGeometry(0.24, 0.028, 8, 20);
            const ring = new THREE.Mesh(ringGeo, burgundyWaxMaterial);
            ring.position.z = 0.05;
            sealGroup.add(ring);

            const ribbonGeo = new THREE.PlaneGeometry(0.16, 0.9);
            const ribbonMat = new THREE.MeshStandardMaterial({ color: 0x9e2a2b, side: THREE.DoubleSide });
            const ribbon1 = new THREE.Mesh(ribbonGeo, ribbonMat);
            ribbon1.position.set(-0.06, -0.5, -0.02);
            ribbon1.rotation.z = 0.15;
            sealGroup.add(ribbon1);

            const ribbon2 = new THREE.Mesh(ribbonGeo, ribbonMat);
            ribbon2.position.set(0.06, -0.48, -0.03);
            ribbon2.rotation.z = -0.18;
            sealGroup.add(ribbon2);

            return sealGroup;
        }

        function createFountainPen() {
            const penGroup = new THREE.Group();
            const barrelGeo = new THREE.CylinderGeometry(0.11, 0.09, 2.2, 20);
            const barrel = new THREE.Mesh(barrelGeo, darkResinMaterial);
            penGroup.add(barrel);

            const ringGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.11, 20);
            const ring = new THREE.Mesh(ringGeo, goldMaterial);
            ring.position.y = 0.45;
            penGroup.add(ring);

            const capGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.2, 20);
            const cap = new THREE.Mesh(capGeo, darkResinMaterial);
            cap.position.y = 1.1;
            penGroup.add(cap);

            const clipGeo = new THREE.BoxGeometry(0.05, 0.9, 0.06);
            const clip = new THREE.Mesh(clipGeo, goldMaterial);
            clip.position.set(0.15, 1.05, 0);
            penGroup.add(clip);

            const gripGeo = new THREE.CylinderGeometry(0.09, 0.06, 0.5, 20);
            const grip = new THREE.Mesh(gripGeo, darkResinMaterial);
            grip.position.y = -1.35;
            penGroup.add(grip);

            const nibGeo = new THREE.ConeGeometry(0.07, 0.35, 4);
            const nib = new THREE.Mesh(nibGeo, goldMaterial);
            nib.position.y = -1.75;
            nib.rotation.y = Math.PI / 4;
            penGroup.add(nib);

            return penGroup;
        }

        function createEyeglasses() {
            const glassesGroup = new THREE.Group();
            const rimGeo = new THREE.TorusGeometry(0.36, 0.022, 12, 32);
            const leftRim = new THREE.Mesh(rimGeo, goldMaterial);
            leftRim.position.x = -0.45;
            glassesGroup.add(leftRim);

            const lensGeo = new THREE.CircleGeometry(0.34, 24);
            const leftLens = new THREE.Mesh(lensGeo, glassMaterial);
            leftLens.position.x = -0.45;
            glassesGroup.add(leftLens);

            const rightRim = new THREE.Mesh(rimGeo, goldMaterial);
            rightRim.position.x = 0.45;
            glassesGroup.add(rightRim);

            const rightLens = new THREE.Mesh(lensGeo, glassMaterial);
            rightLens.position.x = 0.45;
            glassesGroup.add(rightLens);

            const bridgeGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.22, 8);
            const bridge = new THREE.Mesh(bridgeGeo, goldMaterial);
            bridge.rotation.z = Math.PI / 2;
            bridge.position.y = 0.08;
            glassesGroup.add(bridge);

            const templeGeo = new THREE.CylinderGeometry(0.014, 0.014, 1.15, 8);
            const leftTemple = new THREE.Mesh(templeGeo, goldMaterial);
            leftTemple.rotation.x = Math.PI / 2;
            leftTemple.position.set(-0.8, 0.09, -0.58);
            glassesGroup.add(leftTemple);

            const rightTemple = new THREE.Mesh(templeGeo, goldMaterial);
            rightTemple.rotation.x = Math.PI / 2;
            rightTemple.position.set(0.8, 0.09, -0.58);
            glassesGroup.add(rightTemple);

            return glassesGroup;
        }

        // --- Instantiate Props with Scaled Proportions (~18-20% smaller) ---
        // Left Side Objects
        const texBook1 = createCoverTexture('The Written', 'Word', ['#4a0e17', '#6b1d24', '#2d060b'], '#e6c364');
        const book1 = createBookMesh({ width: 2.0, height: 2.8, depth: 0.42, coverTex: texBook1, spineColor: 0x4a0e17 });
        book1.rotation.set(0.3, 0.5, -0.2);
        book1.userData = {
            duration: 5.4,
            offset: 3.3,
            amp: 0.15,
            maxRotZ: 0.06, // ~3.5 deg
            baseRot: book1.rotation.clone()
        };
        scene.add(book1);

        const sheet1 = createCurvedSheet();
        sheet1.rotation.set(-0.35, 0.45, 0.2);
        sheet1.userData = {
            duration: 6.8,
            offset: 0.8,
            amp: 0.14,
            maxRotZ: 0.05, // ~3 deg
            baseRot: sheet1.rotation.clone()
        };
        scene.add(sheet1);

        const waxSeal = createWaxSeal();
        waxSeal.rotation.set(0.2, 0.3, -0.4);
        waxSeal.userData = {
            duration: 4.6,
            offset: 2.0,
            amp: 0.15,
            maxRotZ: 0.08, // ~4.5 deg
            baseRot: waxSeal.rotation.clone()
        };
        scene.add(waxSeal);

        // Right Side Objects

        const fountainPen = createFountainPen();
        fountainPen.rotation.set(-0.5, 0.3, -0.65);
        fountainPen.userData = {
            duration: 5.0,
            offset: 0.2,
            amp: 0.14,
            maxRotZ: 0.05, // ~3 deg
            baseRot: fountainPen.rotation.clone()
        };
        scene.add(fountainPen);

        const sheet2 = createCurvedSheet();
        sheet2.rotation.set(0.4, -0.45, -0.25);
        sheet2.userData = {
            duration: 7.2,
            offset: 1.5,
            amp: 0.13,
            maxRotZ: 0.05, // ~3 deg
            baseRot: sheet2.rotation.clone()
        };
        scene.add(sheet2);

        const eyeglasses = createEyeglasses();
        eyeglasses.rotation.set(0.3, -0.4, 0.15);
        eyeglasses.userData = {
            duration: 6.2,
            offset: 4.1,
            amp: 0.12,
            maxRotZ: 0.05, // ~3 deg
            baseRot: eyeglasses.rotation.clone()
        };
        scene.add(eyeglasses);

        const allProps = [book1, sheet1, waxSeal, fountainPen, sheet2, eyeglasses];

        // --- Ambient Golden Dust ---
        const particleCount = 50;
        const particleGeo = new THREE.BufferGeometry();
        const particlePositions = new Float32Array(particleCount * 3);
        for (let i = 0; i < particleCount * 3; i += 3) {
            particlePositions[i] = (Math.random() - 0.5) * 32;
            particlePositions[i + 1] = (Math.random() - 0.5) * 20;
            particlePositions[i + 2] = (Math.random() - 0.5) * 10;
        }
        particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
        const particleMat = new THREE.PointsMaterial({
            color: 0xdfb76c,
            size: 0.08,
            transparent: true,
            opacity: 0.55,
            blending: THREE.AdditiveBlending
        });
        const particles = new THREE.Points(particleGeo, particleMat);
        scene.add(particles);

        // --- Lighting ---
        const ambientLight = new THREE.AmbientLight(0xfffaec, 1.2);
        scene.add(ambientLight);

        const keyLight = new THREE.DirectionalLight(0xffecd2, 1.8);
        keyLight.position.set(8, 10, 10);
        scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0xb4c6e7, 0.8);
        fillLight.position.set(-8, -4, 6);
        scene.add(fillLight);

        const leftSpot = new THREE.PointLight(0xffb732, 2.5, 20);
        leftSpot.position.set(-10, 2, 6);
        scene.add(leftSpot);

        const rightSpot = new THREE.PointLight(0xffd57a, 2.5, 20);
        rightSpot.position.set(10, 0, 6);
        scene.add(rightSpot);

        // --- 5. PERIPHERY POSITIONING & ZERO-COLLISION GEOMETRY ---
        function repositionProps() {
            const width = window.innerWidth;
            const height = window.innerHeight;
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            renderer.setSize(width, height);

            // Visible 3D world half-dimensions at z = 0
            const halfH = Math.tan((camera.fov * Math.PI / 180) / 2) * camera.position.z;
            const halfW = halfH * camera.aspect;

            // Center reading column is max 820px
            const centerColPx = Math.min(840, width * 0.95);
            const centerFraction = centerColPx / width;
            const centerBoundX = halfW * centerFraction; // Everything between -centerBoundX and +centerBoundX is CENTER

            const gutter3DWidth = halfW - centerBoundX;

            // Hide props on small mobile screens to keep layout clean
            if (width < 940 || gutter3DWidth < 1.4) {
                allProps.forEach(p => p.visible = false);
                return;
            }

            allProps.forEach(p => p.visible = true);

            // Push items further toward viewport periphery/margins (60% into gutter toward edge)
            const leftGutterCenterX = -(centerBoundX + gutter3DWidth * 0.58);
            const rightGutterCenterX = +(centerBoundX + gutter3DWidth * 0.58);

            // --- LEFT SIDE: Generous vertical spacing (~220px-260px apart) ---
            // 1. Upper Left: Manuscript Sheet 1 (back depth layer Z = -1.8)
            sheet1.position.set(leftGutterCenterX + 0.35, 3.6, -1.8);
            sheet1.userData.basePos = sheet1.position.clone();

            // 2. Middle Left: Book 1 ("The Written Word")
            book1.position.set(leftGutterCenterX - 0.2, -0.1, 0.4);
            book1.userData.basePos = book1.position.clone();

            // 3. Lower Left: Wax Seal Bookmark (tucked low)
            waxSeal.position.set(leftGutterCenterX + 0.3, -4.2, 0.8);
            waxSeal.userData.basePos = waxSeal.position.clone();

            // --- RIGHT SIDE: Cleanly spaced items ---
            // 4. Top Right: Fountain Pen (hovering gracefully near top-right edge)
            fountainPen.position.set(rightGutterCenterX - 0.25, 3.4, 1.0);
            fountainPen.userData.basePos = fountainPen.position.clone();

            // 5. Middle Right: Manuscript Sheet 2 (back depth layer Z = -1.6)
            sheet2.position.set(rightGutterCenterX + 0.4, -0.3, -1.6);
            sheet2.userData.basePos = sheet2.position.clone();

            // 6. Bottom Right: Scholar Eyeglasses (tucked lower down at the periphery)
            eyeglasses.position.set(rightGutterCenterX - 0.1, -4.2, 0.9);
            eyeglasses.userData.basePos = eyeglasses.position.clone();
        }

        window.addEventListener('resize', repositionProps);
        repositionProps();

        // --- 6. Mouse Parallax ---
        const mouse = { x: 0, y: 0, targetX: 0, targetY: 0 };
        window.addEventListener('mousemove', (e) => {
            mouse.targetX = (e.clientX / window.innerWidth) * 2 - 1;
            mouse.targetY = -(e.clientY / window.innerHeight) * 2 + 1;
        }, { passive: true });

        // --- 7. Theme Adaptation ---
        const updateThemeLighting = () => {
            const isDark = document.body.classList.contains('dark-mode');
            if (isDark) {
                ambientLight.color.setHex(0xded8cc);
                ambientLight.intensity = 1.0;
                keyLight.intensity = 1.9;
                particleMat.opacity = 0.7;
            } else {
                ambientLight.color.setHex(0xfff8ee);
                ambientLight.intensity = 1.25;
                keyLight.intensity = 1.4;
                particleMat.opacity = 0.45;
            }
        };
        updateThemeLighting();
        const themeObserver = new MutationObserver(() => updateThemeLighting());
        themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

        // --- 8. Render & Organic Non-Colliding Float Loop ---
        const clock = new THREE.Clock();

        function animate() {
            requestAnimationFrame(animate);

            const elapsedTime = clock.getElapsedTime();

            mouse.x += (mouse.targetX - mouse.x) * 0.05;
            mouse.y += (mouse.targetY - mouse.y) * 0.05;

            if (!prefersReducedMotion) {
                camera.position.x = mouse.x * 0.4;
                camera.position.y = mouse.y * 0.25;
                camera.lookAt(0, 0, 0);
            }

            // Each prop bobs gently on its own independent period & phase offset
            allProps.forEach((obj) => {
                if (!obj.visible) return;
                const data = obj.userData;
                if (!data || !data.basePos) return;

                const duration = data.duration || 6.0;
                const offset = data.offset || 0.0;
                const amp = data.amp || 0.15;
                const maxRotZ = data.maxRotZ || 0.06;

                // Frequency = 2pi / duration
                const freq = (Math.PI * 2) / duration;
                const floatOffset = Math.sin(elapsedTime * freq + offset) * amp;

                obj.position.y = data.basePos.y + floatOffset;

                if (!prefersReducedMotion && data.baseRot) {
                    obj.rotation.z = data.baseRot.z + Math.cos(elapsedTime * freq * 0.8 + offset) * maxRotZ;
                }
            });

            // Fountain pen gentle aim toward cursor
            if (fountainPen && !prefersReducedMotion && fountainPen.visible && fountainPen.userData.baseRot) {
                fountainPen.rotation.z = fountainPen.userData.baseRot.z + (mouse.x * 0.15);
                fountainPen.rotation.x = fountainPen.userData.baseRot.x + (mouse.y * 0.12);
            }

            // Ambient golden dust
            if (particles) {
                particles.rotation.y = elapsedTime * 0.015;
                particles.rotation.x = Math.sin(elapsedTime * 0.01) * 0.02;
            }

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
