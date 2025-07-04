import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

class RobotScene {
    constructor() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 2, 8);
        this.camera.lookAt(0, 0, 0);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setClearColor(0x000000, 0);
        this.mixer = null;
        this.robot = null;
        this.robotHead = null;
        this.mouse = new THREE.Vector2();
        this.raycaster = new THREE.Raycaster();
        this.animations = [];
        this.currentAction = null;
        this.walkAction = null;
        this.idleAction = null;
        this.isWalking = false;

        this.init();
    }

    init() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        document.body.appendChild(this.renderer.domElement);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(5, 5, 5);
        directionalLight.castShadow = true;
        this.scene.add(directionalLight);

        const textureLoader = new THREE.TextureLoader();
        const moonTexture = textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/moon_1024.jpg');
        
        const platformRadius = 3; 
        const platformHeight = 0.5;
        const platformSegments = 32;
        
        const platformGeometry = new THREE.CylinderGeometry(
            platformRadius,
            platformRadius,
            platformHeight,
            platformSegments
        );
        const platformMaterial = new THREE.MeshStandardMaterial({ 
            map: moonTexture,
            roughness: 0.8,
            metalness: 0.2
        });
        this.ground = new THREE.Mesh(platformGeometry, platformMaterial);
        
        this.ground.position.y = -platformHeight/2;
        this.ground.receiveShadow = true;
        this.ground.castShadow = true;
        this.scene.add(this.ground);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxPolarAngle = Math.PI / 2.5;
        this.controls.minPolarAngle = Math.PI / 4;
        this.controls.minDistance = 5;
        this.controls.maxDistance = 15;
        this.controls.target.set(0, 0.5, -2);

        this.platformBounds = {
            radius: platformRadius - 1,
            centerX: 0,
            centerZ: 0
        };

        this.loadRobot();

        window.addEventListener('resize', () => this.onWindowResize());
        this.renderer.domElement.addEventListener('click', (event) => this.onClick(event));
        this.renderer.domElement.addEventListener('mousemove', (event) => this.onMouseMove(event));

        this.animate();

        const starSprite = new THREE.TextureLoader().load('https://threejs.org/examples/textures/sprites/circle.png');
        const starCount = 2000;
        const starGeometry = new THREE.BufferGeometry();
        const starVertices = [];
        const starColors = [];
        const starSizes = [];
        const starPalette = [
            '#FFD700', '#FFAA00', '#FCD12A', '#FFE135', '#FFCE00',
            '#E1C699', '#F5DEB3', '#C9B037', '#E5E4E2', '#FFFACD'
        ];

        for (let i = 0; i < starCount; i++) {
            const r = 80 + Math.random() * 15;
            const theta = Math.random() * 2 * Math.PI;
            const phi = Math.acos(2 * Math.random() - 1);
            const x = r * Math.sin(phi) * Math.cos(theta);
            const y = r * Math.sin(phi) * Math.sin(theta);
            const z = r * Math.cos(phi);
            starVertices.push(x, y, z);

            const hex = starPalette[Math.floor(Math.random() * starPalette.length)];
            const color = new THREE.Color(hex);
            starColors.push(color.r, color.g, color.b);

            starSizes.push(1.5 + Math.random() * 2);
        }

        starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
        starGeometry.setAttribute('color', new THREE.Float32BufferAttribute(starColors, 3));
        starGeometry.setAttribute('size', new THREE.Float32BufferAttribute(starSizes, 1));

        const starMaterial = new THREE.PointsMaterial({ 
            map: starSprite, 
            size: 2.5, 
            sizeAttenuation: true, 
            transparent: true, 
            alphaTest: 0.5, 
            vertexColors: true
        });

        this.stars = new THREE.Points(starGeometry, starMaterial);
        this.scene.add(this.stars);
    }

    loadRobot() {
        const loader = new GLTFLoader();
        loader.load(
            'https://modelviewer.dev/shared-assets/models/RobotExpressive.glb',
            (gltf) => {
                this.robot = gltf.scene;
                this.robot.scale.set(0.25, 0.25, 0.25);
                this.robot.position.set(0, 0, -2);
                this.robot.castShadow = true;
                this.robot.receiveShadow = true;
                this.scene.add(this.robot);

                this.findRobotHead();

                this.mixer = new THREE.AnimationMixer(this.robot);
                this.animations = gltf.animations;

                this.idleAction = this.mixer.clipAction(
                    this.animations.find(clip => clip.name === 'Idle')
                );
                this.walkAction = this.mixer.clipAction(
                    this.animations.find(clip => clip.name === 'Walking')
                );

                this.idleAction.setEffectiveWeight(1);
                if (this.robotHead) {
                    this.idleAction.getMixer().addEventListener('loop', () => {
                        if (this.currentAction === this.idleAction) {
                            this.updateHeadTracking();
                        }
                    });
                }

                this.currentAction = this.idleAction;
                this.currentAction.play();
            },
            undefined,
            (error) => {
                console.error('Error loading robot:', error);
            }
        );
    }

    onClick(event) {
        if (!this.robot || this.isWalking) return;

        const mouse = new THREE.Vector2();
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, this.camera);

        const groundIntersects = raycaster.intersectObject(this.ground);
        const robotIntersects = raycaster.intersectObject(this.robot, true);

        if (robotIntersects.length > 0) {
            this.playRandomAnimation();
        } else if (groundIntersects.length > 0) {
            this.walkToPoint(groundIntersects[0].point);
        }
    }

    walkToPoint(targetPoint) {
        const dx = targetPoint.x - this.platformBounds.centerX;
        const dz = targetPoint.z - this.platformBounds.centerZ;
        const distanceFromCenter = Math.sqrt(dx * dx + dz * dz);
        
        if (distanceFromCenter > this.platformBounds.radius) {
            const angle = Math.atan2(dz, dx);
            targetPoint.x = this.platformBounds.centerX + Math.cos(angle) * this.platformBounds.radius;
            targetPoint.z = this.platformBounds.centerZ + Math.sin(angle) * this.platformBounds.radius;
        }

        this.isWalking = true;

        const direction = new THREE.Vector3()
            .subVectors(targetPoint, this.robot.position)
            .normalize();

        const angle = Math.atan2(direction.x, direction.z);
        
        this.robot.rotation.y = angle;

        this.fadeToAction(this.walkAction);

        const distance = this.robot.position.distanceTo(targetPoint);
        const duration = distance * 0.5;

        const startPosition = this.robot.position.clone();
        const startTime = Date.now();

        const animate = () => {
            const now = Date.now();
            const progress = Math.min((now - startTime) / (duration * 1000), 1);

            if (progress < 1) {
                this.robot.position.lerpVectors(startPosition, targetPoint, progress);
                requestAnimationFrame(animate);
            } else {
                this.isWalking = false;
                this.robot.rotation.y = 0;
                this.fadeToAction(this.idleAction);
            }
        };

        animate();
    }

    playRandomAnimation() {
        const availableAnimations = this.animations.filter(clip => 
            clip.name !== 'Idle' && clip.name !== 'Walking'
        );

        if (availableAnimations.length === 0) return;

        const randomAnimation = availableAnimations[
            Math.floor(Math.random() * availableAnimations.length)
        ];

        const action = this.mixer.clipAction(randomAnimation);
        action.setLoop(THREE.LoopOnce);
        action.clampWhenFinished = true;

        this.fadeToAction(action);

        action.getMixer().addEventListener('finished', () => {
            this.fadeToAction(this.idleAction);
        });
    }

    fadeToAction(newAction, duration = 0.2) {
        if (this.currentAction === newAction) return;

        newAction.reset();
        newAction.play();
        newAction.crossFadeFrom(this.currentAction, duration);
        this.currentAction = newAction;
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        this.camera.position.y = Math.max(2, this.camera.position.y);
        this.controls.target.y = Math.max(0.5, this.controls.target.y);
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        if (this.mixer) {
            this.mixer.update(0.016);
        }

        if (this.stars) {
            this.stars.rotation.y += 0.0005;
        }

        if (this.currentAction === this.idleAction) {
            this.updateHeadTracking();
        } else if (this.robotHead) {
            this.robotHead.matrixAutoUpdate = true;
        }

        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    onMouseMove(event) {
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    }

    findRobotHead() {
        if (!this.robot) return;
        
        this.robot.traverse((child) => {
            if (child.name === 'Head') {
                this.robotHead = child;
            }
        });
    }

    updateHeadTracking() {
        if (!this.robotHead || this.currentAction !== this.idleAction) return;

        const targetRotationX = -this.mouse.y * Math.PI / 4;
        const targetRotationY = this.mouse.x * Math.PI / 4;

        this.robotHead.rotation.x = targetRotationX;
        this.robotHead.rotation.y = targetRotationY;

        this.robotHead.updateMatrix();

        this.robotHead.matrixAutoUpdate = false;
    }
}

const robotScene = new RobotScene(); 