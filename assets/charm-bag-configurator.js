const CONFIGURATOR_SELECTOR = '[data-configurator-data]';

const DEG_TO_RAD = Math.PI / 180;

const stateBySection = new Map();

function canUseWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch (error) {
    return false;
  }
}

function getSectionData(section) {
  const dataScript = section.querySelector(CONFIGURATOR_SELECTOR);
  if (!dataScript) return null;
  return JSON.parse(dataScript.textContent);
}

function getProductData(section) {
  const productScript = section.querySelector('[data-configurator-product]');
  if (!productScript) return null;
  return JSON.parse(productScript.textContent);
}

function createMessageHandler(section) {
  const messageEl = section.querySelector('[data-configurator-message]');
  return (text, type = 'info') => {
    if (!messageEl) return;
    messageEl.textContent = text;
    messageEl.dataset.type = type;
  };
}

async function loadThree() {
  const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
  const { OrbitControls } = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js');
  const { GLTFLoader } = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js');
  return { THREE, OrbitControls, GLTFLoader };
}

function limitPixelRatio() {
  const isMobile = window.matchMedia('(max-width: 990px)').matches;
  return Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);
}

function normalizeSlots(bag) {
  return bag.slots
    .filter((slot) => slot.enabled)
    .map((slot) => ({
      ...slot,
      rotation: slot.rotation.map((value) => value * DEG_TO_RAD),
      scale: Array.isArray(slot.scale) ? slot.scale : [slot.scale, slot.scale, slot.scale],
    }));
}

function createSelectionState(productData, config) {
  const baseCharm = {
    id: 'base',
    title: productData.title,
    handle: productData.handle,
    variantId: productData.variantId,
    modelUrl: productData.modelUrl,
    image: productData.image,
    slotId: null,
    isBase: true,
  };

  return {
    activeBagId: config.bags.find((bag) => bag.isDefault)?.id || config.bags[0]?.id,
    charms: [baseCharm],
  };
}

function buildSlotsMarkup(slots, selectedSlotId) {
  return slots
    .map((slot) => {
      return `
        <div class="charm-bag-configurator__slot">
          <span>${slot.label || slot.id}</span>
        </div>
      `;
    })
    .join('');
}

function buildSelectedCharmMarkup(charm, slots) {
  const options = slots
    .map((slot) => {
      const selected = charm.slotId === slot.id ? 'selected' : '';
      return `<option value=\"${slot.id}\" ${selected}>${slot.label || slot.id}</option>`;
    })
    .join('');
  return `
    <div class="charm-bag-configurator__selected-item" data-selected-id="${charm.id}">
      <span>${charm.title}</span>
      <select data-slot-select data-charm-id="${charm.id}">
        ${options}
      </select>
      ${charm.isBase ? '<span>PDP</span>' : '<button type="button" data-remove-charm>Remover</button>'}
    </div>
  `;
}

function updateSelectedList(section, state, slots) {
  const container = section.querySelector('[data-configurator-selected]');
  if (!container) return;
  container.innerHTML = state.charms.map((charm) => buildSelectedCharmMarkup(charm, slots)).join('');
}

function updateSlots(section, slots, selectedSlotId) {
  const container = section.querySelector('[data-configurator-slots]');
  if (!container) return;
  container.innerHTML = slots.length ? buildSlotsMarkup(slots, selectedSlotId) : '<p>Nenhum slot habilitado.</p>';
}

function updateBagButtons(section, activeBagId) {
  section.querySelectorAll('[data-bag-option]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.bagId === activeBagId);
  });
}

function updateExtraVisibility(section, allowExtra) {
  const wrapper = section.querySelector('[data-configurator-extra-wrapper]');
  if (wrapper) {
    wrapper.hidden = !allowExtra;
  }
}

function getActiveSlots(config, state) {
  const bag = config.bags.find((item) => item.id === state.activeBagId);
  return bag ? normalizeSlots(bag) : [];
}

function buildPlacementJSON(config, state, slots) {
  const bag = config.bags.find((item) => item.id === state.activeBagId);
  return {
    bag_id: bag?.id,
    bag_label: bag?.label,
    charms: state.charms.map((charm) => ({
      handle: charm.handle,
      variant_id: charm.variantId,
      slot_id: charm.slotId,
      slot_label: slots.find((slot) => slot.id === charm.slotId)?.label || charm.slotId,
    })),
  };
}

function buildLineItemProperties(config, state, slots, bundleId) {
  const bag = config.bags.find((item) => item.id === state.activeBagId);
  const placementJSON = buildPlacementJSON(config, state, slots);
  return {
    'Bundle ID': bundleId,
    'Bag Model': bag?.label || 'Bolsa',
    'Bag Slots Used': state.charms
      .map((charm) => slots.find((slot) => slot.id === charm.slotId)?.label || charm.slotId)
      .filter(Boolean)
      .join(', '),
    'Bag Charm Placement': JSON.stringify(placementJSON),
  };
}

async function addToCart(items) {
  const response = await fetch('/cart/add.js', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ items }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error?.description || 'Não foi possível adicionar ao carrinho.');
  }

  return response.json();
}

function createRenderer(context) {
  const { THREE } = context;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(limitPixelRatio());
  return renderer;
}

function setupScene(context, config) {
  const { THREE } = context;
  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, config.cameraDistance || 5);

  const ambient = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(3, 5, 4);
  scene.add(dirLight);

  return { scene, camera };
}

function resizeRenderer(renderer, camera, container) {
  const { width, height } = container.getBoundingClientRect();
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function applyTransform(object, slot) {
  object.position.set(slot.position[0], slot.position[1], slot.position[2]);
  object.rotation.set(slot.rotation[0], slot.rotation[1], slot.rotation[2]);
  object.scale.set(slot.scale[0], slot.scale[1], slot.scale[2]);
}

function clearGroup(group) {
  while (group.children.length) {
    group.remove(group.children[0]);
  }
}

async function loadGLB(loader, url, timeoutMs = 15000) {
  let timeoutId;
  const loadPromise = new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve(gltf.scene || gltf.scenes[0]),
      undefined,
      (error) => reject(error)
    );
  });

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error('GLB load timeout'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([loadPromise, timeoutPromise]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function initializeConfigurator(section) {
  const config = getSectionData(section);
  const productData = getProductData(section);
  if (!config || !productData) return;

  const message = createMessageHandler(section);
  const loadingEl = section.querySelector('[data-configurator-loading]');
  const fallbackEl = section.querySelector('[data-configurator-fallback]');
  const fallbackImage = section.querySelector('[data-configurator-fallback-image]');

  if (!canUseWebGL()) {
    if (fallbackEl) fallbackEl.hidden = false;
    if (fallbackImage && config.bags[0]?.thumb) fallbackImage.src = config.bags[0].thumb;
    if (loadingEl) loadingEl.hidden = true;
    message('WebGL indisponível. Mostrando fallback estático.', 'warning');
    return;
  }

  if (loadingEl) loadingEl.hidden = false;

  let context;
  try {
    context = await loadThree();
  } catch (error) {
    console.error(error);
    message('Não foi possível carregar o motor 3D.', 'error');
    if (loadingEl) loadingEl.hidden = true;
    if (fallbackEl) fallbackEl.hidden = false;
    if (fallbackImage && config.bags[0]?.thumb) fallbackImage.src = config.bags[0].thumb;
    return;
  }
  const { THREE, OrbitControls, GLTFLoader } = context;

  const viewer = section.querySelector('[data-configurator-canvas]');
  const renderer = createRenderer(context);
  viewer.appendChild(renderer.domElement);

  const { scene, camera } = setupScene(context, config);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.autoRotate = config.autoRotate;
  controls.minDistance = config.minZoom;
  controls.maxDistance = config.maxZoom;

  const loader = new GLTFLoader();
  const bagGroup = new THREE.Group();
  const charmsGroup = new THREE.Group();
  scene.add(bagGroup);
  scene.add(charmsGroup);

  const state = createSelectionState(productData, config);
  stateBySection.set(section, { state, renderer, camera, scene, controls, bagGroup, charmsGroup, loader, config, context });

  const resizeObserver = new ResizeObserver(() => resizeRenderer(renderer, camera, viewer));
  resizeObserver.observe(viewer);
  resizeRenderer(renderer, camera, viewer);

  let animationFrame;
  const renderLoop = () => {
    controls.update();
    renderer.render(scene, camera);
    animationFrame = requestAnimationFrame(renderLoop);
  };

  renderLoop();

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) {
        cancelAnimationFrame(animationFrame);
      } else {
        renderLoop();
      }
    });
  });
  observer.observe(viewer);

  const selectedBag = config.bags.find((bag) => bag.id === state.activeBagId) || config.bags[0];
  if (!selectedBag) {
    message('Cadastre pelo menos uma bolsa na section.', 'error');
    if (loadingEl) loadingEl.hidden = true;
    return;
  }

  async function setBag(bagId) {
    const bag = config.bags.find((item) => item.id === bagId);
    if (!bag) return;
    state.activeBagId = bag.id;
    updateBagButtons(section, bag.id);
    updateSlots(section, normalizeSlots(bag), state.charms[0].slotId);

    if (loadingEl) loadingEl.hidden = false;
    clearGroup(bagGroup);
    try {
      if (!bag.modelUrl) {
        throw new Error('Bag model URL missing.');
      }
      const model = await loadGLB(loader, bag.modelUrl);
      bagGroup.add(model);
      message('Bolsa carregada.', 'success');
    } catch (error) {
      console.error(error);
      message('Não foi possível carregar a bolsa selecionada.', 'error');
    } finally {
      if (loadingEl) loadingEl.hidden = true;
    }

    if (fallbackImage && bag.thumb) fallbackImage.src = bag.thumb;
  }

  async function setCharms() {
    const bag = config.bags.find((item) => item.id === state.activeBagId);
    const slots = normalizeSlots(bag);
    clearGroup(charmsGroup);

    for (const charm of state.charms) {
      if (!charm.modelUrl) {
        message(`Modelo 3D indisponível para ${charm.title}.`, 'warning');
        continue;
      }
      try {
        const model = await loadGLB(loader, charm.modelUrl);
        const slot = slots.find((slotItem) => slotItem.id === charm.slotId) || slots[0];
        if (!slot) continue;
        applyTransform(model, slot);
        charmsGroup.add(model);
      } catch (error) {
        console.error(error);
        message(`Falha ao carregar o charm ${charm.title}.`, 'error');
      }
    }
  }

  function assignSlots() {
    const bag = config.bags.find((item) => item.id === state.activeBagId);
    if (!bag) return [];
    const slots = normalizeSlots(bag);

    if (config.defaultSlotBehavior === 'first_available') {
      let index = 0;
      state.charms.forEach((charm) => {
        if (slots[index]) {
          charm.slotId = slots[index].id;
          index += 1;
        }
      });
    }

    updateSlots(section, slots, state.charms[0]?.slotId);
    return slots;
  }

  function updateUI() {
    const slots = getActiveSlots(config, state);
    updateSelectedList(section, state, slots);
    updateExtraVisibility(section, config.allowExtraCharms);
    updateBagButtons(section, state.activeBagId);
  }

  function enforceCharmLimit() {
    const maxTotal = config.maxTotalCharms || 3;
    if (state.charms.length > maxTotal) {
      state.charms = state.charms.slice(0, maxTotal);
    }
  }

  updateUI();
  assignSlots();
  await setBag(state.activeBagId);
  await setCharms();

  section.querySelectorAll('[data-bag-option]').forEach((button) => {
    button.addEventListener('click', async () => {
      await setBag(button.dataset.bagId);
      assignSlots();
      await setCharms();
    });
  });

  section.querySelectorAll('[data-extra-option]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!config.allowExtraCharms) return;
      const charmId = button.dataset.charmHandle;
      const exists = state.charms.some((charm) => charm.id === charmId);
      if (exists) return;

      const newCharm = {
        id: charmId,
        title: button.dataset.charmTitle,
        handle: button.dataset.charmHandle,
        variantId: Number(button.dataset.charmVariantId),
        modelUrl: button.dataset.charmModelUrl,
        image: button.querySelector('img')?.src || '',
        slotId: null,
        isBase: false,
      };

      state.charms.push(newCharm);
      enforceCharmLimit();
      assignSlots();
      updateUI();
      await setCharms();
    });
  });

  section.addEventListener('click', async (event) => {
    const removeButton = event.target.closest('[data-remove-charm]');
    if (!removeButton) return;
    const item = removeButton.closest('[data-selected-id]');
    if (!item) return;
    const charmId = item.dataset.selectedId;
    state.charms = state.charms.filter((charm) => charm.id !== charmId);
    assignSlots();
    updateUI();
    await setCharms();
  });

  section.addEventListener('change', async (event) => {
    const select = event.target.closest('[data-slot-select]');
    if (!select) return;
    const charmId = select.dataset.charmId;
    const charm = state.charms.find((item) => item.id === charmId);
    if (!charm) return;
    charm.slotId = select.value;
    await setCharms();
  });

  const resetButton = section.querySelector('[data-configurator-reset]');
  if (resetButton) {
    resetButton.addEventListener('click', () => {
      camera.position.set(0, 0, config.cameraDistance || 5);
      controls.reset();
    });
  }

  const addButton = section.querySelector('[data-configurator-add]');
  if (addButton) {
    addButton.addEventListener('click', async () => {
      const bag = config.bags.find((item) => item.id === state.activeBagId);
      if (!bag) return;
      const slots = normalizeSlots(bag);
      if (!slots.length) {
        message('Nenhum slot disponível para essa bolsa.', 'error');
        return;
      }

      let slotIndex = 0;
      state.charms.forEach((charm) => {
        if (!charm.slotId && slots[slotIndex]) {
          charm.slotId = slots[slotIndex].id;
          slotIndex += 1;
        }
      });
      const bundleId = `bundle-${Date.now()}`;
      const properties = buildLineItemProperties(config, state, slots, bundleId);

      const items = state.charms.map((charm) => ({
        id: charm.variantId,
        quantity: 1,
        properties: {
          ...properties,
          'Bag Slot': slots.find((slot) => slot.id === charm.slotId)?.label || charm.slotId,
        },
      }));

      try {
        addButton.disabled = true;
        message('Adicionando ao carrinho...', 'info');
        await addToCart(items);
        message('Charms adicionados ao carrinho!', 'success');
        document.dispatchEvent(new CustomEvent('cart:refresh'));
      } catch (error) {
        console.error(error);
        message(error.message || 'Erro ao adicionar ao carrinho.', 'error');
      } finally {
        addButton.disabled = false;
      }
    });
  }

  if (loadingEl) loadingEl.hidden = true;
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.charm-bag-configurator').forEach((section) => {
    initializeConfigurator(section).catch((error) => {
      console.error(error);
    });
  });
});
