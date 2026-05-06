import * as THREE from "three";

const VIEWER_DEBUG = true;

function logViewer(stage, data) {
  if (!VIEWER_DEBUG) {
    return;
  }
  const prefix = "[Viewer360]";
  if (data !== undefined) {
    console.log(prefix, stage, data);
  } else {
    console.log(prefix, stage);
  }
}

const state = {
  panos: [],
  annotations: [],
  currentPanoId: null,
  pendingContextYawPitch: null,
};

const elements = {
  panoSelect: document.getElementById("panoSelect"),
  panoMeta: document.getElementById("panoMeta"),
  annotationForm: document.getElementById("annotationForm"),
  annotationId: document.getElementById("annotationId"),
  label: document.getElementById("label"),
  identifier: document.getElementById("identifier"),
  description: document.getElementById("description"),
  x: document.getElementById("x"),
  y: document.getElementById("y"),
  z: document.getElementById("z"),
  yaw: document.getElementById("yaw"),
  pitch: document.getElementById("pitch"),
  captureBtn: document.getElementById("captureBtn"),
  resetBtn: document.getElementById("resetBtn"),
  annotationsList: document.getElementById("annotationsList"),
  toast: document.getElementById("toast"),
  quickAnnotationDialog: document.getElementById("quickAnnotationDialog"),
  quickAnnotationForm: document.getElementById("quickAnnotationForm"),
  qaIdentifier: document.getElementById("qaIdentifier"),
  qaDescription: document.getElementById("qaDescription"),
  qaDistance: document.getElementById("qaDistance"),
  qaCancel: document.getElementById("qaCancel"),
};

class SphereViewer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 1, 1, 2000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.container.appendChild(this.renderer.domElement);

    const caps = this.renderer.capabilities;
    logViewer("WebGLRenderer init", {
      outputColorSpace: this.renderer.outputColorSpace,
      toneMapping: this.renderer.toneMapping,
      toneMappingExposure: this.renderer.toneMappingExposure,
      pixelRatio: this.renderer.getPixelRatio(),
      capabilities: caps
        ? {
            precision: caps.precision,
            maxAnisotropy:
              typeof caps.getMaxAnisotropy === "function" ? caps.getMaxAnisotropy() : undefined,
          }
        : null,
    });

    this.renderer.domElement.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const pos = this.screenToYawPitch(event);
      if (pos && typeof this.onRightClickPanorama === "function") {
        this.onRightClickPanorama(pos);
      }
    });

    this.markerLayer = document.createElement("div");
    this.markerLayer.className = "markerLayer";
    this.container.appendChild(this.markerLayer);

    this._markerTooltipTarget = null;
    this._markerTooltipAnnotation = null;
    this._markerTooltipHideTimer = null;
    this._markerTooltipEditing = false;
    this.markerTooltipEl = this._createMarkerTooltip();
    this.onMarkerTooltipSaved = null;

    document.addEventListener(
      "pointerdown",
      (e) => {
        if (!this.markerTooltipEl.classList.contains("visible")) {
          return;
        }
        if (this.markerTooltipEl.contains(e.target)) {
          return;
        }
        if (this._markerTooltipTarget && this._markerTooltipTarget.contains(e.target)) {
          return;
        }
        this._exitMarkerTooltipEdit(true);
        this._hideMarkerTooltipImmediate();
      },
      true
    );

    this.textureLoader = new THREE.TextureLoader();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.lon = 0;
    this.lat = 0;
    this.radius = 500;
    this.isPointerDown = false;
    this.pointerStart = { x: 0, y: 0, lon: 0, lat: 0 };
    this.currentImageUrl = null;
    this.markers = [];

    const geometry = new THREE.SphereGeometry(this.radius, 96, 64);
    geometry.scale(-1, 1, 1);
    const material = new THREE.MeshBasicMaterial({
      color: 0x202020,
      toneMapped: false,
    });
    this.sphereMesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.sphereMesh);

    logViewer("Sphere material (avant texture)", {
      materialColorHex: "#" + material.color.getHexString(),
      note: "0x202020 assombrit la texture (map * color). Passe a blanc au chargement.",
      toneMapped: material.toneMapped,
    });

    this.container.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.container.addEventListener("pointermove", (event) => this.onPointerMove(event));
    this.container.addEventListener("pointerup", (event) => this.onPointerUp(event));
    this.container.addEventListener("wheel", (event) => this.onWheel(event), { passive: false });
    window.addEventListener("resize", () => this.onResize());

    this.animate();
  }

  _createMarkerTooltip() {
    const root = document.createElement("div");
    root.className = "markerTooltip";
    root.setAttribute("role", "tooltip");

    const view = document.createElement("div");
    view.className = "markerTooltipView";
    view.tabIndex = -1;
    const compactId = document.createElement("div");
    compactId.className = "markerTooltipCompactId";
    const compactDesc = document.createElement("div");
    compactDesc.className = "markerTooltipCompactDesc";
    const compactMeta = document.createElement("div");
    compactMeta.className = "markerTooltipCompactMeta";
    const hint = document.createElement("div");
    hint.className = "markerTooltipHint";
    hint.textContent = "Clic pour modifier";
    view.append(compactId, compactDesc, compactMeta, hint);

    view.addEventListener("click", (e) => {
      e.stopPropagation();
      this._enterMarkerTooltipEdit();
    });

    const edit = document.createElement("div");
    edit.className = "markerTooltipEdit";

    const makeLabel = (text) => {
      const el = document.createElement("span");
      el.className = "markerTooltipLabel";
      el.textContent = text;
      return el;
    };

    const inputId = document.createElement("input");
    inputId.type = "text";
    inputId.autocomplete = "off";
    const inputDesc = document.createElement("textarea");
    inputDesc.rows = 2;

    const actions = document.createElement("div");
    actions.className = "markerTooltipEditActions";
    const btnCancel = document.createElement("button");
    btnCancel.type = "button";
    btnCancel.className = "secondary";
    btnCancel.textContent = "Annuler";
    const btnSave = document.createElement("button");
    btnSave.type = "button";
    btnSave.textContent = "Enregistrer";
    actions.append(btnCancel, btnSave);

    edit.append(
      makeLabel("Identifiant"),
      inputId,
      makeLabel("Description"),
      inputDesc,
      actions
    );

    btnCancel.addEventListener("click", (e) => {
      e.stopPropagation();
      this._exitMarkerTooltipEdit(true);
    });
    btnSave.addEventListener("click", (e) => {
      e.stopPropagation();
      this._saveMarkerTooltipEdit();
    });

    root.append(view, edit);
    document.body.appendChild(root);

    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this._markerTooltipEditing) {
        e.stopPropagation();
        this._exitMarkerTooltipEdit(true);
      }
    });

    root.addEventListener("mouseenter", () => this._cancelMarkerTooltipHide());
    root.addEventListener("mouseleave", () => {
      if (!this._markerTooltipEditing) {
        this._scheduleMarkerTooltipHide(220);
      }
    });
    root.addEventListener("focusin", () => this._cancelMarkerTooltipHide());
    root.addEventListener("focusout", (e) => {
      const rt = e.relatedTarget;
      if (rt && root.contains(rt)) {
        return;
      }
      if (!this._markerTooltipEditing) {
        this._scheduleMarkerTooltipHide(180);
      }
    });

    this._markerTooltipView = view;
    this._markerTooltipCompactId = compactId;
    this._markerTooltipCompactDesc = compactDesc;
    this._markerTooltipCompactMeta = compactMeta;
    this._markerTooltipInputId = inputId;
    this._markerTooltipInputDesc = inputDesc;
    return root;
  }

  _truncate(str, max) {
    if (!str || str.length <= max) {
      return str || "";
    }
    return str.slice(0, max - 1) + "…";
  }

  _fillMarkerTooltipViewFromAnnotation(annotation) {
    const idText =
      (typeof annotation.identifier === "string" && annotation.identifier.trim()) ||
      (annotation.label && String(annotation.label).trim()) ||
      "—";
    this._markerTooltipCompactId.textContent = this._truncate(idText, 28);

    const descRaw =
      typeof annotation.description === "string" && annotation.description.trim()
        ? annotation.description.trim()
        : "";
    if (descRaw) {
      this._markerTooltipCompactDesc.textContent = this._truncate(descRaw, 44);
      this._markerTooltipCompactDesc.classList.remove("isMuted");
    } else {
      this._markerTooltipCompactDesc.textContent = "Aucune description";
      this._markerTooltipCompactDesc.classList.add("isMuted");
    }

    let meta = `XYZ ${annotation.xyz.x.toFixed(1)}, ${annotation.xyz.y.toFixed(1)}, ${annotation.xyz.z.toFixed(1)}`;
    const lib = annotation.label && String(annotation.label).trim();
    if (lib && lib !== idText) {
      meta += ` · ${this._truncate(lib, 18)}`;
    }
    this._markerTooltipCompactMeta.textContent = meta;
  }

  _fillMarkerTooltipInputsFromAnnotation(annotation) {
    const idVal =
      (typeof annotation.identifier === "string" && annotation.identifier.trim()) ||
      (annotation.label && String(annotation.label).trim()) ||
      "";
    this._markerTooltipInputId.value = idVal;
    this._markerTooltipInputDesc.value =
      typeof annotation.description === "string" ? annotation.description : "";
  }

  _cancelMarkerTooltipHide() {
    if (this._markerTooltipHideTimer !== null) {
      window.clearTimeout(this._markerTooltipHideTimer);
      this._markerTooltipHideTimer = null;
    }
  }

  _scheduleMarkerTooltipHide(ms) {
    this._cancelMarkerTooltipHide();
    this._markerTooltipHideTimer = window.setTimeout(() => {
      this._markerTooltipHideTimer = null;
      if (this._markerTooltipEditing) {
        return;
      }
      this._hideMarkerTooltipImmediate();
    }, ms);
  }

  _hideMarkerTooltipImmediate() {
    this._cancelMarkerTooltipHide();
    this._markerTooltipEditing = false;
    this.markerTooltipEl.classList.remove("isEditing", "visible");
    this._markerTooltipTarget = null;
    this._markerTooltipAnnotation = null;
  }

  _exitMarkerTooltipEdit(revert) {
    if (!this._markerTooltipAnnotation) {
      return;
    }
    this._markerTooltipEditing = false;
    this.markerTooltipEl.classList.remove("isEditing");
    if (revert) {
      this._fillMarkerTooltipInputsFromAnnotation(this._markerTooltipAnnotation);
      this._fillMarkerTooltipViewFromAnnotation(this._markerTooltipAnnotation);
    }
    requestAnimationFrame(() => this._positionMarkerTooltip());
  }

  _enterMarkerTooltipEdit() {
    if (!this._markerTooltipAnnotation) {
      return;
    }
    this._cancelMarkerTooltipHide();
    this._markerTooltipEditing = true;
    this._fillMarkerTooltipInputsFromAnnotation(this._markerTooltipAnnotation);
    this.markerTooltipEl.classList.add("isEditing");
    requestAnimationFrame(() => {
      this._positionMarkerTooltip();
      this._markerTooltipInputId.focus();
      this._markerTooltipInputId.select();
    });
  }

  async _saveMarkerTooltipEdit() {
    const ann = this._markerTooltipAnnotation;
    if (!ann) {
      return;
    }
    const ident = this._markerTooltipInputId.value.trim();
    const desc = this._markerTooltipInputDesc.value.trim();
    const label = ident || (ann.label && String(ann.label).trim());
    if (!label) {
      toast("Identifiant requis.", true);
      return;
    }
    try {
      const updated = await api(`/api/annotations/${ann.id}`, {
        method: "PUT",
        body: JSON.stringify({
          panoId: ann.panoId,
          label,
          identifier: ident,
          description: desc,
          xyz: ann.xyz,
          yawPitch: ann.yawPitch,
        }),
      });
      Object.assign(ann, updated);
      this._markerTooltipAnnotation = ann;
      this._fillMarkerTooltipViewFromAnnotation(ann);
      this._exitMarkerTooltipEdit(false);
      if (typeof this.onMarkerTooltipSaved === "function") {
        await this.onMarkerTooltipSaved();
      }
      toast("Annotation mise a jour.");
    } catch (err) {
      toast(err?.message || "Erreur sauvegarde", true);
    }
  }

  _showMarkerTooltip(markerBtn, annotation) {
    this._cancelMarkerTooltipHide();
    this._markerTooltipEditing = false;
    this.markerTooltipEl.classList.remove("isEditing");
    this._markerTooltipTarget = markerBtn;
    this._markerTooltipAnnotation = annotation;
    this._fillMarkerTooltipViewFromAnnotation(annotation);
    this._fillMarkerTooltipInputsFromAnnotation(annotation);

    this.markerTooltipEl.classList.add("visible");
    requestAnimationFrame(() => this._positionMarkerTooltip());
  }

  _positionMarkerTooltip() {
    const markerBtn = this._markerTooltipTarget;
    const tt = this.markerTooltipEl;
    if (!markerBtn || !tt.classList.contains("visible")) {
      return;
    }
    const rect = markerBtn.getBoundingClientRect();
    const margin = 10;
    const cx = rect.left + rect.width / 2;
    tt.style.left = `${cx}px`;
    tt.style.top = `${rect.top}px`;
    tt.style.transform = "translate(-50%, calc(-100% - 10px))";

    const tr = tt.getBoundingClientRect();
    if (tr.top < margin) {
      tt.style.top = `${rect.bottom}px`;
      tt.style.transform = "translate(-50%, 10px)";
    }
    const tr2 = tt.getBoundingClientRect();
    let shiftX = 0;
    if (tr2.right > window.innerWidth - margin) {
      shiftX = window.innerWidth - margin - tr2.right;
    }
    if (tr2.left + shiftX < margin) {
      shiftX = margin - tr2.left;
    }
    if (shiftX !== 0) {
      tt.style.left = `${cx + shiftX}px`;
    }
  }

  async loadPanorama(imageUrl, yawHint = 0) {
    this.currentImageUrl = imageUrl;
    const absoluteUrl =
      imageUrl.startsWith("http://") || imageUrl.startsWith("https://")
        ? imageUrl
        : new URL(imageUrl, window.location.href).href;
    logViewer("Chargement texture", { imageUrl, absoluteUrl });
    const texture = await this.textureLoader.loadAsync(absoluteUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    const mat = this.sphereMesh.material;
    mat.map = texture;
    mat.color.setHex(0xffffff);
    mat.toneMapped = false;
    mat.needsUpdate = true;

    const img = texture.image;
    const imgInfo =
      img && typeof img === "object"
        ? {
            width: img.width,
            height: img.height,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            videoWidth: img.videoWidth,
            complete: img.complete,
          }
        : { raw: String(img) };

    logViewer("Texture appliquee", {
      ...imgInfo,
      textureColorSpace: texture.colorSpace,
      textureFormat: texture.format,
      textureType: texture.type,
      flipY: texture.flipY,
      rendererOutputColorSpace: this.renderer.outputColorSpace,
      rendererToneMapping: this.renderer.toneMapping,
      rendererToneMappingExposure: this.renderer.toneMappingExposure,
      materialColorAfterFixHex: "#" + mat.color.getHexString(),
      materialToneMapped: mat.toneMapped,
      hasMap: Boolean(mat.map),
    });

    this.lon = THREE.MathUtils.radToDeg(yawHint);
    this.lat = 0;
  }

  setMarkers(annotations) {
    this._hideMarkerTooltipImmediate();
    this.markers = annotations;
    this.markerLayer.innerHTML = "";
    for (const annotation of annotations) {
      const marker = document.createElement("button");
      marker.className = "marker";
      marker.type = "button";
      marker.textContent = "•";
      const idForAria =
        (annotation.identifier && String(annotation.identifier).trim()) ||
        (annotation.label && String(annotation.label).trim()) ||
        "Annotation";
      marker.setAttribute(
        "aria-label",
        `${idForAria}, voir details au survol`
      );
      marker.dataset.annotationId = annotation.id;
      marker.addEventListener("click", () => {
        focusAnnotation(annotation);
      });
      marker.addEventListener("mouseenter", () => {
        this._showMarkerTooltip(marker, annotation);
      });
      marker.addEventListener("mouseleave", () => {
        this._scheduleMarkerTooltipHide(200);
      });
      marker.addEventListener("focusin", () => {
        this._showMarkerTooltip(marker, annotation);
      });
      marker.addEventListener("focusout", (e) => {
        const rt = e.relatedTarget;
        if (rt && this.markerTooltipEl.contains(rt)) {
          return;
        }
        this._scheduleMarkerTooltipHide(200);
      });
      this.markerLayer.appendChild(marker);
    }
    this.updateMarkerPositions();
  }

  updateMarkerPositions() {
    const markerNodes = Array.from(this.markerLayer.querySelectorAll(".marker"));
    markerNodes.forEach((node, index) => {
      const annotation = this.markers[index];
      if (!annotation) {
        node.style.display = "none";
        return;
      }
      const projected = this.projectYawPitch(annotation.yawPitch.yaw, annotation.yawPitch.pitch);
      if (!projected || projected.visible !== true) {
        node.style.display = "none";
        return;
      }
      node.style.display = "block";
      node.style.left = `${projected.x}px`;
      node.style.top = `${projected.y}px`;
    });
    if (this.markerTooltipEl.classList.contains("visible") && this._markerTooltipTarget) {
      this._positionMarkerTooltip();
    }
  }

  projectYawPitch(yaw, pitch) {
    const vector = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch)
    ).multiplyScalar(this.radius);

    vector.project(this.camera);
    const visible = vector.z < 1;
    const x = (vector.x * 0.5 + 0.5) * this.container.clientWidth;
    const y = (-vector.y * 0.5 + 0.5) * this.container.clientHeight;
    return { x, y, visible };
  }

  getCurrentYawPitch() {
    return {
      yaw: THREE.MathUtils.degToRad(this.lon),
      pitch: THREE.MathUtils.degToRad(this.lat),
    };
  }

  focusYawPitch(yaw, pitch) {
    this.lon = THREE.MathUtils.radToDeg(yaw);
    this.lat = THREE.MathUtils.radToDeg(pitch);
  }

  onPointerDown(event) {
    if (event.button !== 0) {
      return;
    }
    this.isPointerDown = true;
    this.pointerStart = {
      x: event.clientX,
      y: event.clientY,
      lon: this.lon,
      lat: this.lat,
    };
  }

  onPointerMove(event) {
    if (!this.isPointerDown || event.buttons !== 1) {
      return;
    }
    const deltaX = event.clientX - this.pointerStart.x;
    const deltaY = event.clientY - this.pointerStart.y;
    this.lon = this.pointerStart.lon - deltaX * 0.1;
    this.lat = THREE.MathUtils.clamp(this.pointerStart.lat + deltaY * 0.1, -85, 85);
  }

  onPointerUp(event) {
    if (event.button !== 0) {
      return;
    }
    const wasDragging = Math.abs(event.clientX - this.pointerStart.x) > 4 || Math.abs(event.clientY - this.pointerStart.y) > 4;
    this.isPointerDown = false;
    if (!wasDragging) {
      const clickPosition = this.screenToYawPitch(event);
      if (clickPosition) {
        elements.yaw.value = clickPosition.yaw.toFixed(6);
        elements.pitch.value = clickPosition.pitch.toFixed(6);
      }
    }
  }

  onWheel(event) {
    event.preventDefault();
    this.camera.fov = THREE.MathUtils.clamp(this.camera.fov + event.deltaY * 0.03, 35, 100);
    this.camera.updateProjectionMatrix();
  }

  screenToYawPitch(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersects = this.raycaster.intersectObject(this.sphereMesh, false);
    if (!intersects.length) {
      return null;
    }
    const point = intersects[0].point.clone().normalize();
    const yaw = Math.atan2(point.x, point.z);
    const pitch = Math.asin(point.y);
    return { yaw, pitch };
  }

  onResize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    const phi = THREE.MathUtils.degToRad(90 - this.lat);
    const theta = THREE.MathUtils.degToRad(this.lon);
    const target = new THREE.Vector3(
      this.radius * Math.sin(phi) * Math.sin(theta),
      this.radius * Math.cos(phi),
      this.radius * Math.sin(phi) * Math.cos(theta)
    );
    this.camera.lookAt(target);
    this.renderer.render(this.scene, this.camera);
    this.updateMarkerPositions();
  }
}

const viewer = new SphereViewer("viewer");
viewer.onRightClickPanorama = (yawPitch) => openQuickAnnotationDialog(yawPitch);
viewer.onMarkerTooltipSaved = async () => {
  await loadAnnotations();
};

/**
 * Point monde (repere CSV) : position du pano + direction du rayon (yaw/pitch viewer,
 * tournee par le quaternion du pano) x distance en metres.
 */
function worldXyzFromPanoRay(pano, yaw, pitch, distance) {
  const ori = pano.orientation;
  const q = new THREE.Quaternion(ori.x, ori.y, ori.z, ori.w);
  const localDir = new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch)
  ).normalize();
  const worldDir = localDir.clone().applyQuaternion(q);
  return new THREE.Vector3(pano.position.x, pano.position.y, pano.position.z).add(worldDir.multiplyScalar(distance));
}

function openQuickAnnotationDialog(yawPitch) {
  const pano = currentPano();
  if (!pano || !panoHasImageFile(pano)) {
    toast("Charge un panorama avec image pour annoter au clic droit.", true);
    return;
  }
  state.pendingContextYawPitch = yawPitch;
  elements.qaIdentifier.value = "";
  elements.qaDescription.value = "";
  elements.qaDistance.value = "3";
  elements.quickAnnotationDialog.showModal();
  elements.qaIdentifier.focus();
}

function toast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.classList.add("visible");
  setTimeout(() => elements.toast.classList.remove("visible"), 2200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (response.status === 204) {
    return null;
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Erreur API (${response.status})`);
  }
  return body;
}

function panoHasImageFile(pano) {
  if (pano.image_exists === true) {
    return true;
  }
  if (pano.imageExists === true) {
    return true;
  }
  return false;
}

async function loadPanos() {
  const panos = await api("/api/panos");
  if (!Array.isArray(panos) || !panos.length) {
    throw new Error("Aucun panorama dans le CSV ou reponse API invalide.");
  }
  state.panos = panos;
  renderPanoSelect();
  const firstWithImage = state.panos.find((p) => panoHasImageFile(p));
  const firstPano = firstWithImage || state.panos[0];
  await openPano(firstPano.id);
  if (!panoHasImageFile(firstPano)) {
    toast("Aucun fichier image trouve pour ce pano. Verifie le dossier de donnees.", true);
  }
}

function renderPanoSelect() {
  elements.panoSelect.innerHTML = "";
  for (const pano of state.panos) {
    const option = document.createElement("option");
    option.value = String(pano.id);
    const missing = !panoHasImageFile(pano);
    option.textContent = missing
      ? `${pano.id} - ${pano.filename} (fichier introuvable)`
      : `${pano.id} - ${pano.filename}`;
    elements.panoSelect.appendChild(option);
  }
}

function currentPano() {
  return state.panos.find((item) => item.id === state.currentPanoId) || null;
}

async function openPano(panoId) {
  const pano = state.panos.find((item) => item.id === panoId);
  if (!pano) {
    return;
  }
  state.currentPanoId = panoId;
  elements.panoSelect.value = String(panoId);
  elements.panoMeta.textContent = `XYZ pano: ${pano.position.x.toFixed(2)}, ${pano.position.y.toFixed(2)}, ${pano.position.z.toFixed(2)}`;
  if (!panoHasImageFile(pano)) {
    toast("Fichier image absent sur le disque pour ce panorama.", true);
    await loadAnnotations();
    resetForm();
    return;
  }
  try {
    await viewer.loadPanorama(pano.imageUrl, 0);
  } catch (err) {
    toast(err?.message || "Impossible de charger l'image panorama.", true);
    return;
  }
  await loadAnnotations();
  resetForm();
}

async function loadAnnotations() {
  if (state.currentPanoId === null) {
    return;
  }
  state.annotations = await api(`/api/annotations?panoId=${state.currentPanoId}`);
  renderAnnotationsList();
  viewer.setMarkers(state.annotations);
}

function renderAnnotationsList() {
  elements.annotationsList.innerHTML = "";
  for (const annotation of state.annotations) {
    const row = document.createElement("li");
    row.className = "annotationRow";

    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = annotation.label || "";
    info.appendChild(title);
    info.appendChild(document.createElement("br"));

    const meta = document.createElement("small");
    const idPart = annotation.identifier ? `Id: ${annotation.identifier} · ` : "";
    meta.textContent = `${idPart}XYZ: ${annotation.xyz.x.toFixed(2)}, ${annotation.xyz.y.toFixed(2)}, ${annotation.xyz.z.toFixed(2)}`;
    info.appendChild(meta);

    if (annotation.description) {
      const desc = document.createElement("div");
      desc.className = "annotationDesc";
      desc.textContent = annotation.description;
      info.appendChild(desc);
    }

    const actions = document.createElement("div");
    actions.className = "row";

    const btnFocus = document.createElement("button");
    btnFocus.type = "button";
    btnFocus.textContent = "Viser";
    btnFocus.addEventListener("click", () => focusAnnotation(annotation));

    const btnEdit = document.createElement("button");
    btnEdit.type = "button";
    btnEdit.textContent = "Editer";
    btnEdit.addEventListener("click", () => fillForm(annotation));

    const btnDel = document.createElement("button");
    btnDel.type = "button";
    btnDel.textContent = "Supprimer";
    btnDel.className = "danger";
    btnDel.addEventListener("click", () => removeAnnotation(annotation.id));

    actions.appendChild(btnFocus);
    actions.appendChild(btnEdit);
    actions.appendChild(btnDel);

    row.appendChild(info);
    row.appendChild(actions);
    elements.annotationsList.appendChild(row);
  }
}

function focusAnnotation(annotation) {
  viewer.focusYawPitch(annotation.yawPitch.yaw, annotation.yawPitch.pitch);
}

function fillForm(annotation) {
  elements.annotationId.value = annotation.id;
  elements.label.value = annotation.label;
  elements.identifier.value = annotation.identifier || "";
  elements.description.value = annotation.description || "";
  elements.x.value = annotation.xyz.x;
  elements.y.value = annotation.xyz.y;
  elements.z.value = annotation.xyz.z;
  elements.yaw.value = annotation.yawPitch.yaw;
  elements.pitch.value = annotation.yawPitch.pitch;
}

function resetForm() {
  elements.annotationId.value = "";
  elements.label.value = "";
  elements.identifier.value = "";
  elements.description.value = "";
  elements.x.value = "";
  elements.y.value = "";
  elements.z.value = "";
  const current = viewer.getCurrentYawPitch();
  elements.yaw.value = current.yaw.toFixed(6);
  elements.pitch.value = current.pitch.toFixed(6);
}

async function saveAnnotation(event) {
  event.preventDefault();
  if (state.currentPanoId === null) {
    return;
  }
  const payload = {
    panoId: state.currentPanoId,
    label: elements.label.value.trim(),
    identifier: elements.identifier.value.trim(),
    description: elements.description.value.trim(),
    xyz: {
      x: Number(elements.x.value),
      y: Number(elements.y.value),
      z: Number(elements.z.value),
    },
    yawPitch: {
      yaw: Number(elements.yaw.value),
      pitch: Number(elements.pitch.value),
    },
  };

  try {
    if (elements.annotationId.value) {
      await api(`/api/annotations/${elements.annotationId.value}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      toast("Annotation mise a jour.");
    } else {
      await api("/api/annotations", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      toast("Annotation creee.");
    }
    await loadAnnotations();
    resetForm();
  } catch (error) {
    toast(error.message, true);
  }
}

async function removeAnnotation(annotationId) {
  try {
    await api(`/api/annotations/${annotationId}`, { method: "DELETE" });
    toast("Annotation supprimee.");
    await loadAnnotations();
    resetForm();
  } catch (error) {
    toast(error.message, true);
  }
}

async function saveQuickAnnotation(event) {
  event.preventDefault();
  const pano = currentPano();
  const yp = state.pendingContextYawPitch;
  if (!pano || state.currentPanoId === null || !yp) {
    elements.quickAnnotationDialog.close();
    state.pendingContextYawPitch = null;
    return;
  }
  const identifier = elements.qaIdentifier.value.trim();
  const description = elements.qaDescription.value.trim();
  const distance = Number(elements.qaDistance.value);
  if (!identifier) {
    toast("Identifiant requis.", true);
    return;
  }
  if (!Number.isFinite(distance) || distance <= 0) {
    toast("Distance invalide.", true);
    return;
  }
  const xyzVec = worldXyzFromPanoRay(pano, yp.yaw, yp.pitch, distance);
  const payload = {
    panoId: state.currentPanoId,
    label: identifier,
    identifier,
    xyz: { x: xyzVec.x, y: xyzVec.y, z: xyzVec.z },
    yawPitch: { yaw: yp.yaw, pitch: yp.pitch },
  };
  if (description) {
    payload.description = description;
  }
  try {
    await api("/api/annotations", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    toast("Annotation creee (clic droit).");
    elements.quickAnnotationDialog.close();
    state.pendingContextYawPitch = null;
    await loadAnnotations();
    resetForm();
  } catch (error) {
    toast(error.message, true);
  }
}

function bindEvents() {
  elements.panoSelect.addEventListener("change", async (event) => {
    await openPano(Number(event.target.value));
  });
  elements.annotationForm.addEventListener("submit", saveAnnotation);
  elements.captureBtn.addEventListener("click", () => {
    const current = viewer.getCurrentYawPitch();
    elements.yaw.value = current.yaw.toFixed(6);
    elements.pitch.value = current.pitch.toFixed(6);
  });
  elements.resetBtn.addEventListener("click", () => resetForm());
  elements.quickAnnotationForm.addEventListener("submit", saveQuickAnnotation);
  elements.qaCancel.addEventListener("click", () => {
    elements.quickAnnotationDialog.close();
    state.pendingContextYawPitch = null;
  });
}

async function bootstrap() {
  bindEvents();
  try {
    await loadPanos();
    toast("Viewer pret.");
  } catch (error) {
    toast(error.message, true);
  }
}

bootstrap();
