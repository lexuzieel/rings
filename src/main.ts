import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import * as dat from "dat.gui";
import { locations } from "./locations";

// Constants
const EARTH_RADIUS = 6371; // km
const RING_INNER_RADIUS = EARTH_RADIUS * 1.5;
const RING_OUTER_RADIUS = EARTH_RADIUS * 2.5;
const RING_TILT = 23.5; // degrees (similar to Earth's axial tilt)
const SURFACE_VIEW_HEIGHT = 2; // km above surface
const STARS_COUNT = 2000;

class RingSimulator {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private earth!: THREE.Mesh;
  private rings!: THREE.Mesh;
  private stars!: THREE.Points;
  private gui!: dat.GUI;
  private locationMarker!: THREE.Group;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private isSurfaceView: boolean = false;
  private lastCameraPosition = new THREE.Vector3();
  private lastCameraTarget = new THREE.Vector3();

  // Picture-in-picture elements
  private pipActive: boolean = false;
  private pipRenderer!: THREE.WebGLRenderer;
  private pipCamera!: THREE.PerspectiveCamera;
  private pipControls!: OrbitControls;
  private pipScene!: THREE.Scene; // Separate scene for PIP view
  private pipRings!: THREE.Mesh; // Separate rings for PIP view
  private pipStars!: THREE.Points; // Separate stars for PIP view
  private cameraDirectionArrow!: THREE.ArrowHelper;
  private lastPipLocation = { latitude: 0, longitude: 0 };
  private pipCameraRoll: number = 0;

  private settings = {
    // Location settings
    latitude: 0,
    longitude: 0,
    selectedLocation: "",
    // View settings
    timeOfDay: 12, // start at noon
    ringOpacity: 0.7,
    showStars: true,
    // Camera settings
    cameraDistance: 4,
    autoRotate: false,
    // PIP settings
    pipEnabled: true, // Enable by default
    pipSize: 0.3, // Size as a fraction of the window
    pipPosition: "top-left", // Top-left by default
    pipFov: 75, // Field of view in degrees
    pipHeight: 0.2, // Height above surface in km (reduced default value)
    pipExportSize: "4K", // Export resolution
    // Ring settings
    ringScale: 1.0, // Scale factor for ring size
    // Calibration settings
    textureOffset: 0.5,
    textureRotation: Math.PI,
    earthTilt: 23.5,
    pipRotation: 0,
    pipTilt: 70, // Initial tilt in degrees (looking ~70deg up from horizontal)
  };

  // Add property to track if controls are being dragged
  private isDraggingOrbit: boolean = false;
  private lastDragEndTime: number = 0;
  private dragTotalMovement: number = 0;
  private hasDragged: boolean = false;

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000000
    );

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      logarithmicDepthBuffer: true,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(this.renderer.domElement);

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.setupCamera();
    this.setupControls();
    this.createEarth();
    this.createRings();
    this.createStars();
    this.createLocationMarker();
    this.setupLighting();
    this.setupPictureInPicture();
    this.setupGUI();
    this.setupEventListeners();

    // Store initial camera position
    this.lastCameraPosition.copy(this.camera.position);
    this.lastCameraTarget.copy(this.controls.target);

    this.animate();
  }

  private setupCamera(): void {
    this.camera.position.z = EARTH_RADIUS * this.settings.cameraDistance;
  }

  private setupControls(): void {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.enablePan = false;
    this.controls.minDistance = EARTH_RADIUS * 1.2;
    this.controls.maxDistance = EARTH_RADIUS * 10;
    this.controls.autoRotate = this.settings.autoRotate;
    this.controls.autoRotateSpeed = 0.5;

    // Save camera position when controls stop
    this.controls.addEventListener("end", () => {
      this.lastCameraPosition.copy(this.camera.position);
      this.lastCameraTarget.copy(this.controls.target);
    });
  }

  private createEarth(): void {
    const textureLoader = new THREE.TextureLoader();
    const earthTexture = textureLoader.load("/earth_texture.jpg", (texture) => {
      texture.offset.x = this.settings.textureOffset;
      texture.wrapS = THREE.RepeatWrapping;
      this.updateView();
    });

    const earthGeometry = new THREE.SphereGeometry(EARTH_RADIUS, 64, 64);
    const earthMaterial = new THREE.MeshPhongMaterial({
      map: earthTexture,
      specular: 0x333333,
      shininess: 5,
    });
    this.earth = new THREE.Mesh(earthGeometry, earthMaterial);

    this.updateEarthRotation();
    this.scene.add(this.earth);
  }

  private updateEarthRotation(): void {
    // Reset rotations
    this.earth.rotation.set(0, 0, 0);

    // Apply base rotation (for texture alignment)
    this.earth.rotation.y = this.settings.textureRotation;

    // Apply axial tilt
    this.earth.rotation.z = THREE.MathUtils.degToRad(this.settings.earthTilt);
  }

  private createRings(): void {
    const textureLoader = new THREE.TextureLoader();
    const ringTexture = textureLoader.load("/saturn-rings.jpg");

    const ringGeometry = new THREE.RingGeometry(
      RING_INNER_RADIUS * this.settings.ringScale,
      RING_OUTER_RADIUS * this.settings.ringScale,
      128
    );
    const ringMaterial = new THREE.MeshBasicMaterial({
      map: ringTexture,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: this.settings.ringOpacity,
      alphaTest: 0.1,
    });
    this.rings = new THREE.Mesh(ringGeometry, ringMaterial);
    this.rings.rotation.x = THREE.MathUtils.degToRad(RING_TILT);
    this.scene.add(this.rings);

    // Add UV mapping for the ring texture
    const pos = ringGeometry.attributes.position;
    const v3 = new THREE.Vector3();
    const uv = [];

    for (let i = 0; i < pos.count; i++) {
      v3.fromBufferAttribute(pos, i);
      const radius = v3.length();
      const angle = Math.atan2(v3.y, v3.x);

      // Map radius to U coordinate (0 to 1 from inner to outer)
      const u =
        (radius - RING_INNER_RADIUS * this.settings.ringScale) /
        (RING_OUTER_RADIUS * this.settings.ringScale -
          RING_INNER_RADIUS * this.settings.ringScale);
      // Map angle to V coordinate
      const v = (angle + Math.PI) / (Math.PI * 2);

      uv.push(u, v);
    }

    ringGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  }

  private createStars(): void {
    const starsGeometry = new THREE.BufferGeometry();
    const starPositions = new Float32Array(STARS_COUNT * 3);
    const starColors = new Float32Array(STARS_COUNT * 3);

    for (let i = 0; i < STARS_COUNT; i++) {
      const radius = 500000; // Far away from Earth
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);

      starPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      starPositions[i * 3 + 2] = radius * Math.cos(phi);

      // Random star colors (mostly white with some blue and yellow tints)
      const colorChoice = Math.random();
      if (colorChoice > 0.9) {
        starColors[i * 3] = 0.8 + Math.random() * 0.2; // Red
        starColors[i * 3 + 1] = 0.8 + Math.random() * 0.2; // Green
        starColors[i * 3 + 2] = 0.6; // Blue (yellowish)
      } else {
        starColors[i * 3] = 0.8; // Red
        starColors[i * 3 + 1] = 0.8; // Green
        starColors[i * 3 + 2] = 1.0; // Blue (blueish white)
      }
    }

    starsGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(starPositions, 3)
    );
    starsGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(starColors, 3)
    );

    const starsMaterial = new THREE.PointsMaterial({
      size: 2,
      vertexColors: true,
      transparent: true,
    });

    this.stars = new THREE.Points(starsGeometry, starsMaterial);
    this.scene.add(this.stars);
  }

  private createLocationMarker(): void {
    // Create a group to hold all marker elements
    const markerGroup = new THREE.Group();
    this.locationMarker = markerGroup;

    // Create marker base (small sphere)
    const baseGeometry = new THREE.SphereGeometry(EARTH_RADIUS * 0.01, 16, 16);
    const baseMaterial = new THREE.MeshBasicMaterial({ color: 0xff3300 });
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    markerGroup.add(base);

    // Create vertical line pointing upwards
    const lineGeometry = new THREE.CylinderGeometry(
      EARTH_RADIUS * 0.002,
      EARTH_RADIUS * 0.002,
      EARTH_RADIUS * 0.1,
      8
    );
    const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xff3300 });
    const line = new THREE.Mesh(lineGeometry, lineMaterial);
    line.position.y = EARTH_RADIUS * 0.05; // Position above the base
    markerGroup.add(line);

    // Create surrounding circle
    const circleGeometry = new THREE.RingGeometry(
      EARTH_RADIUS * 0.03,
      EARTH_RADIUS * 0.035,
      32
    );
    const circleMaterial = new THREE.MeshBasicMaterial({
      color: 0xff3300,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5,
    });
    const circle = new THREE.Mesh(circleGeometry, circleMaterial);
    // Rotate circle to be in XZ plane instead of XY plane
    circle.rotation.x = Math.PI / 2;
    markerGroup.add(circle);

    // Add camera direction indicator
    const arrowDir = new THREE.Vector3(0, 1, 0);
    const arrowOrigin = new THREE.Vector3(0, EARTH_RADIUS * 0.02, 0);
    const arrowLength = EARTH_RADIUS * 0.15;
    const arrowColor = 0x00ff00;
    this.cameraDirectionArrow = new THREE.ArrowHelper(
      arrowDir,
      arrowOrigin,
      arrowLength,
      arrowColor,
      EARTH_RADIUS * 0.02,
      EARTH_RADIUS * 0.01
    );
    this.cameraDirectionArrow.visible = false;
    markerGroup.add(this.cameraDirectionArrow);

    this.scene.add(this.locationMarker);
    this.updateLocationMarker();
  }

  private setupLighting(): void {
    // Increase ambient light intensity
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    // Add directional light for better illumination
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(1, 1, 1).normalize();
    this.scene.add(directionalLight);

    // Add point light for highlights
    const pointLight = new THREE.PointLight(0xffffff, 0.5);
    pointLight.position.set(100000, 10000, 100000);
    this.scene.add(pointLight);
  }

  private setupPictureInPicture(): void {
    // Create PIP renderer
    this.pipRenderer = new THREE.WebGLRenderer({
      antialias: true,
      logarithmicDepthBuffer: true,
      alpha: true,
    });

    // Create separate scene for PIP
    this.pipScene = new THREE.Scene();
    this.pipScene.background = new THREE.Color(0x000000);

    // Copy relevant elements to PIP scene - but NOT the Earth or marker
    this.createPipSceneElements();

    // Calculate initial size with 16:9 aspect ratio
    const pipWidth = window.innerWidth * this.settings.pipSize;
    const pipHeight = pipWidth / (16 / 9);
    this.pipRenderer.setSize(pipWidth, pipHeight);

    // Style the PIP container
    const pipContainer = document.createElement("div");
    pipContainer.id = "pip-container";
    pipContainer.style.position = "absolute";

    // Set initial position to top-left
    pipContainer.style.top = "20px";
    pipContainer.style.left = "20px";
    pipContainer.style.bottom = "auto";
    pipContainer.style.right = "auto";

    pipContainer.style.border = "2px solid white";
    pipContainer.style.borderRadius = "5px";
    pipContainer.style.overflow = "hidden";
    pipContainer.style.boxShadow = "0 0 10px rgba(0,0,0,0.5)";
    pipContainer.style.zIndex = "1000";
    pipContainer.style.display = this.settings.pipEnabled ? "block" : "none";
    pipContainer.appendChild(this.pipRenderer.domElement);
    document.body.appendChild(pipContainer);

    // Add save button
    const saveButton = document.createElement("button");
    saveButton.textContent = "Export";
    saveButton.style.position = "absolute";
    saveButton.style.top = "5px";
    saveButton.style.right = "5px";
    saveButton.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
    saveButton.style.color = "white";
    saveButton.style.border = "1px solid white";
    saveButton.style.borderRadius = "3px";
    saveButton.style.padding = "2px 8px";
    saveButton.style.fontSize = "14px";
    saveButton.style.cursor = "pointer";
    saveButton.style.zIndex = "1001";
    saveButton.title = "Capture high-resolution image";
    saveButton.addEventListener("click", () => this.captureHighResImage());
    pipContainer.appendChild(saveButton);

    // Create PIP camera with custom FOV
    this.pipCamera = new THREE.PerspectiveCamera(
      this.settings.pipFov,
      16 / 9, // Force 16:9 aspect ratio
      0.1,
      1000000
    );

    // Use simple object for controls to prevent OrbitControls issues
    this.pipControls = { update: () => {} } as any;

    // Track mouse position for manual camera rotation
    let isDragging = false;
    let previousMouseX = 0;
    let previousMouseY = 0;
    let rotationAngle = 0;
    let tiltAngle = this.settings.pipTilt;

    // Add rotation with mouse
    pipContainer.addEventListener("mousedown", (e) => {
      isDragging = true;
      previousMouseX = e.clientX;
      previousMouseY = e.clientY;
      pipContainer.style.cursor = "grabbing";
      e.stopPropagation(); // Prevent event from bubbling to document
    });

    // Use the pipContainer for mousemove events instead of document
    pipContainer.addEventListener("mousemove", (e) => {
      if (!isDragging) return;

      // Calculate horizontal and vertical deltas
      const deltaX = e.clientX - previousMouseX;
      const deltaY = e.clientY - previousMouseY;

      // Update angles with appropriate sensitivity
      rotationAngle += deltaX * 0.01; // Horizontal sensitivity
      tiltAngle -= deltaY * 0.2; // Vertical sensitivity (negative for natural direction)

      // Clamp tilt angle to avoid impossible views
      tiltAngle = Math.max(10, Math.min(170, tiltAngle)); // Limit between 10° and 170°

      // Update previous positions
      previousMouseX = e.clientX;
      previousMouseY = e.clientY;

      // Update camera orientation - will be applied in updatePictureInPicture
      this.settings.pipRotation = rotationAngle;
      this.settings.pipTilt = tiltAngle;

      // Force update
      this.updatePictureInPicture();
      e.stopPropagation(); // Prevent event from bubbling to document
    });

    // Add mouse wheel for FOV control
    pipContainer.addEventListener("wheel", (e) => {
      // Prevent default scroll behavior
      e.preventDefault();

      // Adjust FOV based on wheel direction
      // Negative delta means scroll up (zoom in, decrease FOV)
      // Positive delta means scroll down (zoom out, increase FOV)
      const delta = e.deltaY;
      const fovChange = delta * 0.05; // Scale factor for sensitivity

      // Update FOV with limits
      this.settings.pipFov = Math.max(
        20,
        Math.min(120, this.settings.pipFov + fovChange)
      );

      // Update camera
      this.pipCamera.fov = this.settings.pipFov;
      this.pipCamera.updateProjectionMatrix();

      // Update GUI
      this.gui.updateDisplay();

      // Force update
      this.updatePictureInPicture();
    });

    // Setup keyboard controls for height adjustment
    document.addEventListener("keydown", (e) => {
      // Only process if PIP is enabled and we're not in an input field
      if (!this.settings.pipEnabled || e.target instanceof HTMLInputElement) {
        return;
      }

      // W/S keys for camera height adjustment
      if (e.key === "w" || e.key === "W") {
        // Move camera up
        this.settings.pipHeight = Math.min(5, this.settings.pipHeight * 1.1);
        this.updatePictureInPicture();
        this.gui.updateDisplay();
      } else if (e.key === "s" || e.key === "S") {
        // Move camera down (allow going below surface)
        this.settings.pipHeight = Math.max(-2, this.settings.pipHeight * 0.9);
        this.updatePictureInPicture();
        this.gui.updateDisplay();
      }

      // Q/E keys for FOV adjustment
      if (e.key === "q" || e.key === "Q") {
        // Decrease FOV (zoom in)
        this.settings.pipFov = Math.max(20, this.settings.pipFov - 2);
        this.pipCamera.fov = this.settings.pipFov;
        this.pipCamera.updateProjectionMatrix();
        this.updatePictureInPicture();
        this.gui.updateDisplay();
      } else if (e.key === "e" || e.key === "E") {
        // Increase FOV (zoom out)
        this.settings.pipFov = Math.min(120, this.settings.pipFov + 2);
        this.pipCamera.fov = this.settings.pipFov;
        this.pipCamera.updateProjectionMatrix();
        this.updatePictureInPicture();
        this.gui.updateDisplay();
      }
    });

    // Handle mouseup on the container itself
    pipContainer.addEventListener("mouseup", (e) => {
      if (isDragging) {
        isDragging = false;
        pipContainer.style.cursor = "grab";
        e.stopPropagation(); // Prevent event from bubbling
      }
    });

    // Handle case when mouse leaves the container while dragging
    pipContainer.addEventListener("mouseleave", (e) => {
      if (isDragging) {
        isDragging = false;
        pipContainer.style.cursor = "grab";
      }
    });

    // Add global mouseup handler as a fallback
    document.addEventListener("mouseup", () => {
      if (isDragging) {
        isDragging = false;
        pipContainer.style.cursor = "grab";
      }
    });

    // Set initial cursor
    pipContainer.style.cursor = "grab";

    // Initialize rotation setting
    this.settings.pipRotation = 0;

    // Add instructions overlay
    const instructions = document.createElement("div");
    instructions.style.position = "absolute";
    instructions.style.top = "5px";
    instructions.style.left = "5px";
    instructions.style.color = "white";
    instructions.style.fontSize = "10px";
    instructions.style.textShadow = "1px 1px 1px black";
    instructions.style.opacity = "0.8";
    instructions.textContent =
      "Drag to rotate/tilt - W/S: height - Mouse wheel: FOV";
    pipContainer.appendChild(instructions);

    // Add resize handle
    const resizeHandle = document.createElement("div");
    resizeHandle.style.position = "absolute";
    resizeHandle.style.bottom = "0";
    resizeHandle.style.right = "0";
    resizeHandle.style.width = "20px";
    resizeHandle.style.height = "20px";
    resizeHandle.style.cursor = "nwse-resize";
    resizeHandle.style.background = "rgba(255, 255, 255, 0.5)";
    pipContainer.appendChild(resizeHandle);

    // Add resize functionality
    let isResizing = false;
    let startX = 0,
      startY = 0;
    let startWidth = 0,
      startHeight = 0;

    resizeHandle.addEventListener("mousedown", (e) => {
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startWidth = pipContainer.offsetWidth;
      startHeight = pipContainer.offsetHeight;
      e.preventDefault();
      e.stopPropagation(); // Prevent event from bubbling
    });

    // Handle resize on container to prevent interference
    pipContainer.addEventListener("mousemove", (e) => {
      if (!isResizing) return;

      // Calculate new width based on mouse position
      const width = startWidth + (e.clientX - startX);

      // Force 16:9 aspect ratio by calculating height from width
      const height = width / (16 / 9);

      // Update container and renderer size
      pipContainer.style.width = `${width}px`;
      pipContainer.style.height = `${height}px`;
      this.pipRenderer.setSize(width, height);

      // Update camera aspect ratio
      this.pipCamera.aspect = 16 / 9;
      this.pipCamera.updateProjectionMatrix();

      // Update settings
      this.settings.pipSize = width / window.innerWidth;
      e.stopPropagation(); // Prevent event from bubbling
    });

    // Also handle resize on document to handle out-of-bounds mouse movement
    document.addEventListener("mousemove", (e) => {
      if (!isResizing) return;

      // Calculate new width based on mouse position
      const width = startWidth + (e.clientX - startX);

      // Set minimum size
      const minSize = 200; // Increased minimum size
      const finalWidth = Math.max(width, minSize);

      // Force 16:9 aspect ratio
      const finalHeight = finalWidth / (16 / 9);

      // Update container and renderer size
      pipContainer.style.width = `${finalWidth}px`;
      pipContainer.style.height = `${finalHeight}px`;
      this.pipRenderer.setSize(finalWidth, finalHeight);

      // Update camera aspect ratio
      this.pipCamera.aspect = 16 / 9;
      this.pipCamera.updateProjectionMatrix();

      // Update settings
      this.settings.pipSize = finalWidth / window.innerWidth;
    });

    // Handle mouseup for resize on both container and document
    pipContainer.addEventListener("mouseup", (e) => {
      if (isResizing) {
        isResizing = false;
        e.stopPropagation(); // Prevent event from bubbling
      }
    });

    document.addEventListener("mouseup", () => {
      isResizing = false;
    });

    // Also handle case when mouse leaves during resize
    document.addEventListener("mouseleave", () => {
      isResizing = false;
    });
  }

  // Create elements for the PIP scene
  private createPipSceneElements(): void {
    // Copy lighting from main scene
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.pipScene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(1, 1, 1).normalize();
    this.pipScene.add(directionalLight);

    const pointLight = new THREE.PointLight(0xffffff, 0.5);
    pointLight.position.set(100000, 10000, 100000);
    this.pipScene.add(pointLight);

    // Create rings
    this.createPipRings();

    // Copy the stars
    const starsGeometry = new THREE.BufferGeometry();
    const starPositions = new Float32Array(STARS_COUNT * 3);
    const starColors = new Float32Array(STARS_COUNT * 3);

    for (let i = 0; i < STARS_COUNT; i++) {
      const radius = 500000; // Far away from Earth
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);

      starPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      starPositions[i * 3 + 2] = radius * Math.cos(phi);

      // Random star colors (mostly white with some blue and yellow tints)
      const colorChoice = Math.random();
      if (colorChoice > 0.9) {
        starColors[i * 3] = 0.8 + Math.random() * 0.2; // Red
        starColors[i * 3 + 1] = 0.8 + Math.random() * 0.2; // Green
        starColors[i * 3 + 2] = 0.6; // Blue (yellowish)
      } else {
        starColors[i * 3] = 0.8; // Red
        starColors[i * 3 + 1] = 0.8; // Green
        starColors[i * 3 + 2] = 1.0; // Blue (blueish white)
      }
    }

    starsGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(starPositions, 3)
    );
    starsGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(starColors, 3)
    );

    const starsMaterial = new THREE.PointsMaterial({
      size: 2,
      vertexColors: true,
      transparent: true,
    });

    this.pipStars = new THREE.Points(starsGeometry, starsMaterial);
    this.pipScene.add(this.pipStars);
  }

  // New method to create/update only the PIP rings
  private createPipRings(): void {
    // Remove existing rings if they exist
    if (this.pipRings) {
      this.pipScene.remove(this.pipRings);
    }

    // Create new rings with current scale
    const ringGeometry = new THREE.RingGeometry(
      RING_INNER_RADIUS * this.settings.ringScale,
      RING_OUTER_RADIUS * this.settings.ringScale,
      128
    );
    const textureLoader = new THREE.TextureLoader();
    const ringTexture = textureLoader.load("/saturn-rings.jpg");
    const ringMaterial = new THREE.MeshBasicMaterial({
      map: ringTexture,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: this.settings.ringOpacity,
      alphaTest: 0.1,
    });
    this.pipRings = new THREE.Mesh(ringGeometry, ringMaterial);
    this.pipRings.rotation.x = THREE.MathUtils.degToRad(RING_TILT);
    this.pipScene.add(this.pipRings);

    // Add UV mapping for the ring texture
    const pos = ringGeometry.attributes.position;
    const v3 = new THREE.Vector3();
    const uv = [];

    for (let i = 0; i < pos.count; i++) {
      v3.fromBufferAttribute(pos, i);
      const radius = v3.length();
      const angle = Math.atan2(v3.y, v3.x);

      // Map radius to U coordinate (0 to 1 from inner to outer)
      const u =
        (radius - RING_INNER_RADIUS * this.settings.ringScale) /
        (RING_OUTER_RADIUS * this.settings.ringScale -
          RING_INNER_RADIUS * this.settings.ringScale);
      // Map angle to V coordinate
      const v = (angle + Math.PI) / (Math.PI * 2);

      uv.push(u, v);
    }

    ringGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  }

  private updatePictureInPicture(): void {
    const pipContainer = document.getElementById("pip-container");
    if (!pipContainer) return;

    // Toggle visibility based on settings
    pipContainer.style.display = this.settings.pipEnabled ? "block" : "none";

    if (!this.settings.pipEnabled) return;

    // Check if location has changed
    const locationChanged =
      this.lastPipLocation.latitude !== this.settings.latitude ||
      this.lastPipLocation.longitude !== this.settings.longitude;

    // Update location memory
    this.lastPipLocation.latitude = this.settings.latitude;
    this.lastPipLocation.longitude = this.settings.longitude;

    // Get exact marker position directly - ensures perfect alignment
    const markerPos = this.locationMarker.position.clone();
    const surfaceNormal = markerPos.clone().normalize();

    // Calculate position based on user-specified height (can be negative)
    const cameraPos = surfaceNormal
      .clone()
      .multiplyScalar(EARTH_RADIUS + this.settings.pipHeight);

    // Position camera at surface location
    this.pipCamera.position.copy(cameraPos);

    // Always update the up vector to match surface normal
    this.pipCamera.up.copy(surfaceNormal);

    // Get time-based rotation for viewing direction
    const hourAngle = (this.settings.timeOfDay / 24) * Math.PI * 2;

    // IMPROVED METHOD: Create a guaranteed perpendicular vector to the normal

    // Step 1: Choose a reference vector that's definitely not parallel to normal
    // The world Y-axis is a good choice unless we're at the poles
    let referenceVector = new THREE.Vector3(0, 1, 0);

    // If we're too close to the poles, use X-axis instead
    if (Math.abs(surfaceNormal.y) > 0.9) {
      referenceVector.set(1, 0, 0);
    }

    // Step 2: Create a perpendicular vector using cross product
    // First perpendicular vector (east direction)
    const eastVector = new THREE.Vector3()
      .crossVectors(referenceVector, surfaceNormal)
      .normalize();

    // Step 3: Create a second perpendicular vector (north direction)
    // This is perpendicular to both normal and east
    const northVector = new THREE.Vector3()
      .crossVectors(surfaceNormal, eastVector)
      .normalize();

    // Step 4: Apply rotation around normal based on time + user input
    const totalRotation = hourAngle + (this.settings.pipRotation || 0);

    // Use trigonometric rotation in the tangent plane
    const viewDirection = new THREE.Vector3()
      .addScaledVector(eastVector, Math.sin(totalRotation))
      .addScaledVector(northVector, Math.cos(totalRotation))
      .normalize();

    // Double-check perpendicularity and force it if necessary
    const dotProduct = viewDirection.dot(surfaceNormal);
    if (Math.abs(dotProduct) > 0.001) {
      // Remove any component along the normal
      viewDirection
        .sub(surfaceNormal.clone().multiplyScalar(dotProduct))
        .normalize();
    }

    // For the camera, apply both tilt and rotation
    const lookDirection = new THREE.Vector3();

    // Convert tilt angle from settings (now user-controlled)
    const tiltRad = THREE.MathUtils.degToRad(this.settings.pipTilt);

    // Combine the view direction and normal with appropriate weights based on tilt
    // When tilt is 90 degrees, we look straight up along the normal
    // When tilt is 0 degrees, we look along the tangent plane
    const tiltFactor = Math.sin(tiltRad);
    const planeFactor = Math.cos(tiltRad);

    lookDirection
      .addScaledVector(viewDirection, planeFactor)
      .addScaledVector(surfaceNormal, tiltFactor)
      .normalize();

    // Set the target far in the look direction
    const targetDistance = EARTH_RADIUS * 5;
    const target = this.pipCamera.position
      .clone()
      .add(lookDirection.multiplyScalar(targetDistance));

    // Update FOV to match settings
    this.pipCamera.fov = this.settings.pipFov;
    this.pipCamera.updateProjectionMatrix();

    // Point camera at target
    this.pipCamera.lookAt(target);

    // Update camera direction arrow on marker
    if (this.cameraDirectionArrow) {
      // Use the view direction in the tangent plane for the arrow
      // This should now be EXACTLY perpendicular to the normal
      this.cameraDirectionArrow.visible = this.settings.pipEnabled;
      this.cameraDirectionArrow.setDirection(viewDirection);

      // Position at base of normal line
      this.cameraDirectionArrow.position.set(0, EARTH_RADIUS * 0.01, 0);
    }
  }

  private setupGUI(): void {
    if (this.gui) {
      this.gui.destroy();
    }

    this.gui = new dat.GUI({
      width: 300,
      closeOnTop: false,
    });

    // Create a custom container for dat.GUI
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.top = "10px";
    container.style.right = "10px";
    document.body.appendChild(container);

    // Move the dat.GUI instance to our container
    container.appendChild(this.gui.domElement);

    // Location folder
    const locationFolder = this.gui.addFolder("Location");

    // Add location dropdown
    const locationOptions = ["Custom", ...locations.map((loc) => loc.name)];
    locationFolder
      .add(this.settings, "selectedLocation", locationOptions)
      .name("Select Location")
      .onChange((value: string) => {
        if (value === "Custom") return;
        const location = locations.find((loc) => loc.name === value);
        if (location) {
          this.settings.latitude = location.latitude;
          this.settings.longitude = location.longitude;
          this.updateView();
        }
      });

    locationFolder
      .add(this.settings, "latitude", -90, 90, 0.1)
      .name("Latitude")
      .onChange(this.updateView.bind(this));

    locationFolder
      .add(this.settings, "longitude", -180, 180, 0.1)
      .name("Longitude")
      .onChange(this.updateView.bind(this));

    // Add coordinates display to the folder
    const coordsController = {
      coordinates: `${this.settings.latitude.toFixed(
        4
      )}°, ${this.settings.longitude.toFixed(4)}°`,
    };
    locationFolder
      .add(coordsController, "coordinates")
      .name("Coordinates")
      .listen();

    // Update the coordinates controller when location changes
    const originalUpdateView = this.updateView.bind(this);
    this.updateView = () => {
      originalUpdateView();
      coordsController.coordinates = `${this.settings.latitude.toFixed(
        4
      )}°, ${this.settings.longitude.toFixed(4)}°`;
    };

    // View settings
    const viewFolder = this.gui.addFolder("View Settings");
    viewFolder
      .add(this.settings, "timeOfDay", 0, 24, 0.1)
      .name("Time (24h)")
      .onChange(this.updateView.bind(this));

    viewFolder
      .add(this.settings, "ringOpacity", 0, 1, 0.01)
      .name("Ring Opacity")
      .onChange((value: number) => {
        (this.rings.material as THREE.MeshBasicMaterial).opacity = value;
        if (this.pipRings) {
          (this.pipRings.material as THREE.MeshBasicMaterial).opacity = value;
        }
      });

    viewFolder
      .add(this.settings, "ringScale", 0.5, 2, 0.1)
      .name("Ring Scale")
      .onChange((value: number) => {
        // Recreate rings with new scale
        this.scene.remove(this.rings);
        this.createRings();

        // Update PIP rings if they exist
        if (this.pipScene) {
          this.createPipRings();
        }
      });

    viewFolder
      .add(this.settings, "showStars")
      .name("Show Stars")
      .onChange((value: boolean) => {
        this.stars.visible = value;
        if (this.pipStars) {
          this.pipStars.visible = value;
        }
      });

    // PIP settings
    const pipFolder = this.gui.addFolder("Picture in Picture");
    pipFolder
      .add(this.settings, "pipEnabled")
      .name("Enable PIP")
      .onChange((value) => {
        this.updatePictureInPicture();
      });

    // Add PIP FOV control
    pipFolder
      .add(this.settings, "pipFov", 20, 120, 1)
      .name("FOV")
      .onChange((value) => {
        this.pipCamera.fov = value;
        this.pipCamera.updateProjectionMatrix();
        this.updatePictureInPicture();
      });

    // Add PIP Height control with logarithmic scale for better control
    pipFolder
      .add(this.settings, "pipHeight", -2, 5, 0.01)
      .name("Height (km)")
      .onChange(() => {
        this.updatePictureInPicture();
      });

    // Add export resolution selector
    pipFolder
      .add(this.settings, "pipExportSize", ["HD", "Full HD", "2K", "4K", "8K"])
      .name("Export Size");

    const positionOptions = {
      "Top-Left": "top-left",
      "Top-Right": "top-right",
      "Bottom-Left": "bottom-left",
      "Bottom-Right": "bottom-right",
    };

    pipFolder
      .add(this.settings, "pipPosition", positionOptions)
      .name("Position")
      .onChange((value) => {
        const pipContainer = document.getElementById("pip-container");
        if (!pipContainer) return;

        // Reset all positions
        pipContainer.style.top = "auto";
        pipContainer.style.bottom = "auto";
        pipContainer.style.left = "auto";
        pipContainer.style.right = "auto";

        // Set new position
        if (value.includes("top")) {
          pipContainer.style.top = "20px";
        } else {
          pipContainer.style.bottom = "20px";
        }

        if (value.includes("left")) {
          pipContainer.style.left = "20px";
        } else {
          pipContainer.style.right = "20px";
        }
      });

    // Camera settings
    const cameraFolder = this.gui.addFolder("Camera");
    cameraFolder
      .add(this.settings, "cameraDistance", 1.2, 10, 0.1)
      .name("Distance")
      .onChange((value: number) => {
        if (!this.isSurfaceView) {
          const dir = this.camera.position.clone().normalize();
          this.camera.position.copy(dir.multiplyScalar(EARTH_RADIUS * value));
          // Save position when manually changed
          this.lastCameraPosition.copy(this.camera.position);
        }
      });

    cameraFolder
      .add(this.settings, "autoRotate")
      .name("Auto Rotate")
      .onChange((value: boolean) => {
        this.controls.autoRotate = value;
      });

    // Expert settings (hidden by default)
    const expertFolder = this.gui.addFolder("Expert Settings");
    expertFolder
      .add(this.settings, "textureOffset", 0, 1, 0.01)
      .name("Texture Offset")
      .onChange(() => {
        const texture = (this.earth.material as THREE.MeshPhongMaterial).map;
        if (texture) {
          texture.offset.x = this.settings.textureOffset;
          texture.needsUpdate = true;
        }
      });

    expertFolder
      .add(this.settings, "textureRotation", 0, Math.PI * 2, 0.01)
      .name("Texture Rotation")
      .onChange(() => {
        this.updateEarthRotation();
        this.updateView();
      });

    expertFolder
      .add(this.settings, "earthTilt", -90, 90, 0.1)
      .name("Earth Tilt")
      .onChange(() => {
        this.updateEarthRotation();
        this.updateView();
      });

    // Open main folders by default
    locationFolder.open();
    viewFolder.open();
    pipFolder.open();
    cameraFolder.open();
  }

  private setupEventListeners(): void {
    window.addEventListener("resize", this.onWindowResize.bind(this));

    // Track OrbitControls drag state with improved movement detection
    this.renderer.domElement.addEventListener("mousedown", (e) => {
      this.isDraggingOrbit = true;
      this.dragTotalMovement = 0;
      this.hasDragged = false;
    });

    this.renderer.domElement.addEventListener("mousemove", (e) => {
      if (this.isDraggingOrbit) {
        // Track movement distance during drag
        this.dragTotalMovement += Math.abs(e.movementX) + Math.abs(e.movementY);
        if (this.dragTotalMovement > 10) {
          this.hasDragged = true;
        }
      }
    });

    document.addEventListener("mouseup", () => {
      this.lastDragEndTime = Date.now();
      this.isDraggingOrbit = false;
    });

    // Add click event listener for Earth surface selection
    this.renderer.domElement.addEventListener(
      "click",
      this.onEarthClick.bind(this)
    );
  }

  private updateLocationMarker(): void {
    const phi = THREE.MathUtils.degToRad(90 - this.settings.latitude);
    const theta = THREE.MathUtils.degToRad(this.settings.longitude);

    // Calculate position on the sphere (before applying Earth rotation/tilt)
    const x = EARTH_RADIUS * Math.sin(phi) * Math.cos(theta);
    const y = EARTH_RADIUS * Math.cos(phi);
    const z = EARTH_RADIUS * Math.sin(phi) * Math.sin(theta);

    // Create matrices for Earth rotation
    const textureRotationMatrix = new THREE.Matrix4().makeRotationY(
      this.settings.textureRotation
    );
    const tiltMatrix = new THREE.Matrix4().makeRotationZ(
      THREE.MathUtils.degToRad(this.settings.earthTilt)
    );

    // Combine rotations to match Earth's orientation
    const rotationMatrix = new THREE.Matrix4().multiplyMatrices(
      tiltMatrix,
      textureRotationMatrix
    );

    // Apply combined rotation to marker position
    const markerPosition = new THREE.Vector3(x, y, z);
    markerPosition.applyMatrix4(rotationMatrix);

    // Calculate normal direction (same as position vector for a sphere)
    const normal = markerPosition.clone().normalize();

    // Set marker position slightly above surface
    const surfaceOffset = 1.02; // Small offset from surface
    markerPosition.normalize().multiplyScalar(EARTH_RADIUS * surfaceOffset);
    this.locationMarker.position.copy(markerPosition);

    // Orient marker to align with surface normal
    const upVector = new THREE.Vector3(0, 1, 0);
    this.locationMarker.quaternion.setFromUnitVectors(upVector, normal);
  }

  private updateCoordinatesDisplay(): void {
    const coordsDisplay = document.getElementById("coordinates-display");
    if (coordsDisplay) {
      coordsDisplay.textContent = `${this.settings.latitude.toFixed(
        4
      )}°, ${this.settings.longitude.toFixed(4)}°`;
    }
  }

  private updatePositionIndicator(): void {
    const indicator = document.getElementById("position-indicator");
    if (indicator) {
      indicator.innerHTML = `
                Location: ${this.settings.latitude.toFixed(
                  2
                )}°N, ${this.settings.longitude.toFixed(2)}°E
            `;
    }
  }

  private updateView(): void {
    this.updateLocationMarker();
    if (document.getElementById("coordinates-display")) {
      this.updateCoordinatesDisplay();
    }
    if (document.getElementById("position-indicator")) {
      this.updatePositionIndicator();
    }

    // Also update PIP if enabled
    if (this.settings.pipEnabled) {
      this.updatePictureInPicture();
    }

    // Update Earth rotation based on time of day
    const hourAngle = (this.settings.timeOfDay / 24) * Math.PI * 2;
    this.earth.rotation.y = this.settings.textureRotation + hourAngle;

    // Update location dropdown if needed
    if (this.settings.selectedLocation !== "Custom") {
      const currentLocation = locations.find(
        (loc) =>
          Math.abs(loc.latitude - this.settings.latitude) < 0.1 &&
          Math.abs(loc.longitude - this.settings.longitude) < 0.1
      );
      if (!currentLocation) {
        this.settings.selectedLocation = "Custom";
        this.gui.updateDisplay();
      }
    }
  }

  private onWindowResize(): void {
    // Update main camera and renderer
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // Update PIP camera and renderer
    if (this.settings.pipEnabled) {
      const pipContainer = document.getElementById("pip-container");
      if (pipContainer) {
        const width = pipContainer.offsetWidth;
        const height = pipContainer.offsetHeight;
        this.pipCamera.aspect = width / height;
        this.pipCamera.updateProjectionMatrix();
        this.pipRenderer.setSize(width, height);
      }
    }
  }

  private animate(): void {
    requestAnimationFrame(this.animate.bind(this));

    // Update main view
    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    // Update PIP view if enabled
    if (this.settings.pipEnabled) {
      this.updatePictureInPicture();
      this.pipControls.update();

      // Update PIP rings rotation to match main rings
      if (this.pipRings && this.rings) {
        this.pipRings.rotation.copy(this.rings.rotation);
      }

      // Render PIP scene instead of main scene
      this.pipRenderer.render(this.pipScene, this.pipCamera);
    }
  }

  private onEarthClick(event: MouseEvent): void {
    // Skip this click if it's part of a drag operation
    if (this.hasDragged) {
      this.hasDragged = false; // Reset for next interaction
      return;
    }

    // Calculate mouse position in normalized device coordinates
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // Update the picking ray with the camera and mouse position
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Calculate objects intersecting the picking ray
    const intersects = this.raycaster.intersectObject(this.earth);

    if (intersects.length > 0) {
      const intersectPoint = intersects[0].point;

      // Create matrices for Earth rotation (inverse to undo Earth's current rotation)
      const tiltMatrix = new THREE.Matrix4().makeRotationZ(
        -THREE.MathUtils.degToRad(this.settings.earthTilt)
      );
      const textureRotationMatrix = new THREE.Matrix4().makeRotationY(
        -this.settings.textureRotation
      );

      // Apply inverses in correct order
      const untiltedPoint = intersectPoint
        .clone()
        .applyMatrix4(tiltMatrix)
        .applyMatrix4(textureRotationMatrix);

      // Convert intersection point to latitude and longitude
      const radius = untiltedPoint.length();

      // Calculate latitude: 90° - angle between point and y-axis
      const latitude =
        90 -
        THREE.MathUtils.radToDeg(
          Math.acos(Math.max(-1, Math.min(1, untiltedPoint.y / radius)))
        );

      // Calculate longitude: angle in the XZ plane (atan2 gives angle in range [-π,π])
      let longitude = THREE.MathUtils.radToDeg(
        Math.atan2(untiltedPoint.z, untiltedPoint.x)
      );

      // Update settings and view
      this.settings.latitude = latitude;
      this.settings.longitude = longitude;
      this.settings.selectedLocation = "Custom";
      this.gui.updateDisplay();
      this.updateView();

      // Find closest location for potential selection
      const closestLocation = this.findClosestLocation(latitude, longitude);
      if (closestLocation) {
        this.settings.selectedLocation = closestLocation.name;
        this.gui.updateDisplay();
      }
    }
  }

  private findClosestLocation(
    latitude: number,
    longitude: number
  ): { name: string; latitude: number; longitude: number } | null {
    // Find the closest location within 2 degrees
    const closestLocation = locations.find((loc) => {
      const latDiff = Math.abs(loc.latitude - latitude);
      const lonDiff = Math.abs(loc.longitude - longitude);
      return latDiff < 2 && lonDiff < 2;
    });

    return closestLocation || null;
  }

  // High-resolution image capture method
  private captureHighResImage(): void {
    // Define resolution mapping
    const resolutions = {
      HD: { width: 1280, height: 720 },
      "Full HD": { width: 1920, height: 1080 },
      "2K": { width: 2560, height: 1440 },
      "4K": { width: 3840, height: 2160 },
      "8K": { width: 7680, height: 4320 },
    };

    // Get resolution from settings
    const resolution =
      resolutions[this.settings.pipExportSize as keyof typeof resolutions];

    // Create a temporary renderer for high-res output
    const hiResRenderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: true, // Enable transparency
    });

    // Set resolution
    hiResRenderer.setSize(resolution.width, resolution.height);

    // Copy camera settings
    const hiResCamera = this.pipCamera.clone();
    hiResCamera.aspect = 16 / 9;
    hiResCamera.updateProjectionMatrix();

    // Store current scene background
    const originalBackground = this.pipScene.background;
    const starsVisible = this.pipStars.visible;

    // Make background transparent and hide stars for export
    this.pipScene.background = null;
    this.pipStars.visible = false;

    // Render the scene to the high-res renderer
    hiResRenderer.render(this.pipScene, hiResCamera);

    // Get image data
    const imageData = hiResRenderer.domElement.toDataURL("image/png");

    // Create a download link
    const downloadLink = document.createElement("a");
    downloadLink.href = imageData;
    downloadLink.download = `ring-view-${this.settings.latitude.toFixed(
      1
    )}_${this.settings.longitude.toFixed(1)}-${Math.floor(
      Date.now() / 1000
    )}.png`;

    // Trigger download
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);

    // Restore original settings
    this.pipScene.background = originalBackground;
    this.pipStars.visible = starsVisible;

    // Clean up
    hiResRenderer.dispose();
  }
}

// Create instance
const simulator = new RingSimulator();

// Export for debugging
(window as any).simulator = simulator;
