/* eslint strict: "off" */
/* eslint no-undef: "error" */

/* global hljs, showdown, gl */

//'use strict';

// TODO:
// * connect uniform sampler to texture unit
// * fix enabled/disable attribute colors
// * texture mips
// * breakpoints
// * step to
// * add help for each line
// * continue flashing

import * as twgl from '/3rdparty/twgl-full.module.js';
import {
  px,
  formatBoolean,
  formatUniformValue,
  createTemplate,
  updateElem,
  helpToMarkdown,
  addElem,
  createTable,
} from './webgl-state-diagram-utils.js';
import {
  vertexArrayState,
  textureState,
  activeTexNote,
  shaderState,
  programState,
  globalState,
} from './webgl-state-diagram-state-tables.js';
import {
  formatWebGLObject,
  addWebGLObjectInfo,
  getWebGLObjectInfo,
  formatWebGLObjectOrDefaultVAO,
} from './webgl-state-diagram-context-wrapper.js';
import Stepper from './webgl-state-diagram-stepper.js';
import ArrowManager from './webgl-state-diagram-arrows.js';

function main() {

  hljs.initHighlightingOnLoad();

  gl = document.querySelector('canvas').getContext('webgl');  /* eslint-disable-line */
  twgl.addExtensionsToContext(gl);

  const diagramElem = document.querySelector('#diagram');
  const codeElem = document.querySelector('#code');
  const stepper = new Stepper();
  const arrowManager = new ArrowManager(document.querySelector('#arrows'));
  const webglObjectTypeToColorMap = new Map();

  const glEnumToString = twgl.glEnumToString;
  const formatEnum = v => glEnumToString(gl, v);

  function flash(elem) {
    elem.classList.remove('flash');
    setTimeout(() => {
      elem.classList.add('flash');
    }, 1);
  }


  const converter = new showdown.Converter();
  const hintElem = document.querySelector('#hint');
  let lastWidth;
  let lastHint;
  function setHint(e, hint = '') {
    if (lastHint !== hint) {
      lastHint = hint;
      const html = converter.makeHtml(hint);
      hintElem.innerHTML = html;
      hintElem.querySelectorAll('pre>code').forEach(elem => hljs.highlightBlock(elem));
      lastWidth = hintElem.clientWidth;
    }
    hintElem.style.left = px(e.pageX + lastWidth > window.innerWidth ? window.innerWidth - lastWidth : e.pageX + 5);
    hintElem.style.top = px(e.pageY + 5);
    hintElem.style.display = hint ? '' : 'none';
  }
  document.body.addEventListener('mousemove', function(e) {
    let elem = e.target;
    while (!elem.dataset.help && elem.nodeName !== 'BODY') {
        elem = elem.parentElement;
    }
    setHint(e, elem.dataset.help);
  });

  let dragTarget;
  let dragMouseStartX;
  let dragMouseStartY;
  let dragTargetStartX;
  let dragTargetStartY;

  function toggleExpander(e) {
    e.preventDefault();
    e.stopPropagation();
    e.target.parentElement.classList.toggle('open');
  }

  function moveToFront(elemToFront) {
    const elements = [];
    document.querySelectorAll('.draggable').forEach(elem => {
      if (elem !== elemToFront) {
        elements.push(elem);
      }
    });
    elements.sort((a, b) => a.style.zIndex > b.style.zIndex);
    elements.push(elemToFront);
    elements.forEach((elem, ndx) => {
      elem.style.zIndex = ndx + 1;
    });
  }

  function dragStart(e) {
    e.preventDefault();
    e.stopPropagation();
    dragTarget = this;
    const rect = this.getBoundingClientRect();
    dragMouseStartX = e.pageX;
    dragMouseStartY = e.pageY;
    dragTargetStartX = (window.scrollX + rect.left) | 0; // parseInt(this.style.left || '0');
    dragTargetStartY = (window.scrollY + rect.top) | 0;  // parseInt(this.style.top || '0');

    window.addEventListener('mousemove', dragMove, {passive: false});
    window.addEventListener('mouseup', dragStop, {passive: false});

    moveToFront(this);
  }

  function dragMove(e) {
    if (dragTarget) {
      e.preventDefault();
      e.stopPropagation();
      const x = dragTargetStartX + (e.pageX - dragMouseStartX);
      const y = dragTargetStartY + (e.pageY - dragMouseStartY);
      dragTarget.style.left = px(x);
      dragTarget.style.top = px(y);
      arrowManager.update();
    }
  }

  function dragStop(e) {
    e.preventDefault();
    e.stopPropagation();
    dragTarget = undefined;
    window.removeEventListener('mousemove', dragMove);
    window.removeEventListener('mouseup', dragStop);
  }

  // format for position is selfSide:baseSide:offset.
  // eg.: left:right-10 = put our left side - 10 units from right of base
  const windowPositions = [
    { note: 'vertex-array', base: '#diagram',       x: 'left:left+10',   y: 'bottom:bottom-10', },
    { note: 'global-state', base: '#diagram',       x: 'left:left+10',   y: 'top:top+10', },
    { note: 'canvas',       base: '#diagram',       x: 'right:right-10', y: 'top:top+10', },
    { note: 'v-shader',     base: 'canvas',         x: 'left:left-50',   y: 'top:bottom+10', },
    { note: 'f-shader',     base: 'vertexShader',   x: 'left:left+0',    y: 'top:bottom+10', },
    { note: 'program',      base: 'global state',   x: 'left:right+10',  y: 'top:top+0', },
    { note: 'p-buffer',     base: 'canvas',         x: 'left:left+70',   y: 'top:bottom+10', },
    { note: 'n-buffer',     base: 'positionBuffer', x: 'left:left-0',    y: 'top:bottom+10', },
    { note: 't-buffer',     base: 'normalBuffer',   x: 'left:left-0',    y: 'top:bottom+10', },
    { note: 'i-buffer',     base: 'texcoordBuffer', x: 'left:left-0',    y: 'top:bottom+10', },
    { note: 'texture ',     base: 'indexBuffer',    x: 'left:left-0',    y: 'top:bottom+10', },
  ];
  let windowCount = 0;
  function getNextWindowPosition(elem) {
    const info = windowPositions[windowCount++];
    let x = windowCount * 10;
    let y = windowCount * 10;
    if (info) {
      const {base, x: xDesc, y: yDesc} = info;
      const baseElem = getWindowElem(base);
      x = computeRelativePosition(elem, baseElem, xDesc);
      y = computeRelativePosition(elem, baseElem, yDesc);
    }
    return {x, y};
  }

  const relRE = /(\w+):(\w+)([-+]\d+)/;
  function computeRelativePosition(elem, base, desc) {
    try {
    const [, elemSide, baseSide, offset] = relRE.exec(desc);
    const rect = elem.getBoundingClientRect();
    const elemRect = {
      left: 0,
      top: 0,
      right: -rect.width,
      bottom: -rect.height,
    };
    const baseRect = base.getBoundingClientRect();
    return elemRect[elemSide] + baseRect[baseSide] + parseInt(offset) | 0;
    } catch (e) {
      console.error(e);
      debugger;
    }
  }

  function getWindowElem(name) {
    const nameElem = [...diagramElem.querySelectorAll('.name')].find(elem => elem.textContent.indexOf(name) >= 0);
    if (nameElem) {
      let elem = nameElem;
      while (!elem.classList.contains('draggable')) {
        elem = elem.parentElement;
      }
      return elem;
    }
    return name === '#diagram' ? diagramElem : null;
  }

  function makeDraggable(elem) {
    const div = addElem('div', elem.parentElement, {
      className: 'draggable',
    });
    elem.parentElement.removeChild(elem);
    div.appendChild(elem);
    const pos = getNextWindowPosition(div);
    div.style.left = px(pos.x);
    div.style.top = px(pos.y);
    div.addEventListener('mousedown', dragStart, {passive: false});
  }

  function createExpander(parent, title, attrs = {}) {
    const outer = addElem('div', parent, Object.assign({className: 'expander'}, attrs));
    const titleElem = addElem('div', outer, {
      textContent: title,
    });
    titleElem.addEventListener('click', toggleExpander);
    titleElem.addEventListener('mousedown', (e) => e.stopPropagation());
    return outer;
  }

  const elemToArrowMap = new Map();
  function createStateTable(states, parent, title, queryFn, update = true) {
    const expander = createExpander(parent, title);
    const table = addElem('table', expander);
    const tbody = addElem('tbody', table);
    for (const state of states) {
      const {pname, help} = state;
      const tr = addElem('tr', tbody);
      tr.dataset.help = helpToMarkdown(help);
      addElem('td', tr, {textContent: pname});
      addElem('td', tr);
    }
    if (update) {
      updateStateTable(states, expander, queryFn, true);
    }
    return expander;
  }

  function querySelectorClassInclusive(elem, className) {
    return elem.classList.contains(className)
        ? elem
        : elem.querySelector(`.${className}`);
  }

  const hsl = (h, s, l) => `hsl(${h * 360 | 0}, ${s * 100 | 0}%, ${l * 100 | 0}%)`;

  function getColorForWebGLObject(webglObject, elem) {
    const win = querySelectorClassInclusive(elem, 'window-content');
    const style = getComputedStyle(win);
    const c = chroma(style.backgroundColor).hsl();
    return hsl(c[0] / 360, 1, 0.8);
  }

  function updateStateTable(states, parent, queryFn, initial) {
    const tbody = parent.querySelector('tbody');
    // NOTE: Assumption that states array is parallel to table rows
    states.forEach((state, rowNdx) => {
      const {formatter} = state;
      const raw = queryFn(state);
      const value = formatter(raw);
      const row = tbody.rows[rowNdx];
      const cell = row.cells[1];
      const isNew = cell.textContent !== value;
      cell.textContent = value;
      // FIX: should put this data else were instead of guessing
      if (isNew) {
        if (formatter === formatWebGLObject || formatter === formatWebGLObjectOrDefaultVAO) {
          const oldArrow = elemToArrowMap.get(cell);
          if (oldArrow) {
            arrowManager.remove(oldArrow);
            elemToArrowMap.delete(cell);
          }
          const targetInfo = raw
              ? getWebGLObjectInfo(raw)
              : (formatter === formatWebGLObjectOrDefaultVAO)
                  ? defaultVAOInfo
                  : null;
          if (targetInfo && !targetInfo.deleted) {            
            elemToArrowMap.set(
                cell,
                arrowManager.add(
                    cell,
                    targetInfo.ui.elem.querySelector('.name'),
                    getColorForWebGLObject(raw, targetInfo.ui.elem)));
          }
        }
      }

      if (!initial && isNew) {
        flash(row);
      }
    });
  }

  function isBuiltIn(info) {
    const name = info.name;
    return name.startsWith("gl_") || name.startsWith("webgl_");
  }

  function createProgramAttributes(parent, gl, program) {
    const tbody = createTable(parent, ['name', 'location']);

    const scan = () => {
      tbody.innerHTML = '';
      flash(tbody);

      const numAttribs = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
      for (let ii = 0; ii < numAttribs; ++ii) {
        const attribInfo = gl.getActiveAttrib(program, ii);
        if (isBuiltIn(attribInfo)) {
            continue;
        }
        const index = gl.getAttribLocation(program, attribInfo.name);
        const tr = addElem('tr', tbody);
        const help = helpToMarkdown(`
          get attribute location with

          ---js
          const loc = gl.getAttribLocation(program, '${attribInfo.name}');
          ---
          
          attribute locations are chosen by WebGL. You can choose locations
          by calling.

          ---js
          gl.bindAttribLocation(program, desiredLocation, '${attribInfo.name}');
          ---

          **BEFORE** calling
          
          ---js
          gl.linkProgram(program);
          ---
        `);
        addElem('td', tr, {textContent: attribInfo.name, dataset: {help}});
        addElem('td', tr, {textContent: index, dataset: {help}});
      }
    };

    scan();

    return {
      elem: tbody,
      scan,
    };
  }

  const getUniformInfo = (function() {

  const FLOAT                         = 0x1406;
  const FLOAT_VEC2                    = 0x8B50;
  const FLOAT_VEC3                    = 0x8B51;
  const FLOAT_VEC4                    = 0x8B52;
  const INT                           = 0x1404;
  const INT_VEC2                      = 0x8B53;
  const INT_VEC3                      = 0x8B54;
  const INT_VEC4                      = 0x8B55;
  const BOOL                          = 0x8B56;
  const BOOL_VEC2                     = 0x8B57;
  const BOOL_VEC3                     = 0x8B58;
  const BOOL_VEC4                     = 0x8B59;
  const FLOAT_MAT2                    = 0x8B5A;
  const FLOAT_MAT3                    = 0x8B5B;
  const FLOAT_MAT4                    = 0x8B5C;
  const SAMPLER_2D                    = 0x8B5E;
  const SAMPLER_CUBE                  = 0x8B60;
  const SAMPLER_3D                    = 0x8B5F;
  const SAMPLER_2D_SHADOW             = 0x8B62;
  const FLOAT_MAT2x3                  = 0x8B65;
  const FLOAT_MAT2x4                  = 0x8B66;
  const FLOAT_MAT3x2                  = 0x8B67;
  const FLOAT_MAT3x4                  = 0x8B68;
  const FLOAT_MAT4x2                  = 0x8B69;
  const FLOAT_MAT4x3                  = 0x8B6A;
  const SAMPLER_2D_ARRAY              = 0x8DC1;
  const SAMPLER_2D_ARRAY_SHADOW       = 0x8DC4;
  const SAMPLER_CUBE_SHADOW           = 0x8DC5;
  const UNSIGNED_INT                  = 0x1405;
  const UNSIGNED_INT_VEC2             = 0x8DC6;
  const UNSIGNED_INT_VEC3             = 0x8DC7;
  const UNSIGNED_INT_VEC4             = 0x8DC8;
  const INT_SAMPLER_2D                = 0x8DCA;
  const INT_SAMPLER_3D                = 0x8DCB;
  const INT_SAMPLER_CUBE              = 0x8DCC;
  const INT_SAMPLER_2D_ARRAY          = 0x8DCF;
  const UNSIGNED_INT_SAMPLER_2D       = 0x8DD2;
  const UNSIGNED_INT_SAMPLER_3D       = 0x8DD3;
  const UNSIGNED_INT_SAMPLER_CUBE     = 0x8DD4;
  const UNSIGNED_INT_SAMPLER_2D_ARRAY = 0x8DD7;

  const TEXTURE_2D                    = 0x0DE1;
  const TEXTURE_CUBE_MAP              = 0x8513;
  const TEXTURE_3D                    = 0x806F;
  const TEXTURE_2D_ARRAY              = 0x8C1A;

  const typeMap = {};

  /**
   * Returns the corresponding bind point for a given sampler type
   */
  //function getBindPointForSamplerType(gl, type) {
  //  return typeMap[type].bindPoint;
  //}

  // This kind of sucks! If you could compose functions as in `var fn = gl[name];`
  // this code could be a lot smaller but that is sadly really slow (T_T)

  const floatSetter = 'gl.uniform1f(location, value);';
  const floatArraySetter = 'gl.uniform1fv(location, arrayOfValues);';
  const floatVec2Setter = 'gl.uniform2fv(location, arrayOf2Values); // or\ngl.uniform2f(location, v0, v1);';
  const floatVec3Setter = 'gl.uniform3fv(location, arrayOf3Values); // or\ngl.uniform3f(location, v0, v1, v2);';
  const floatVec4Setter = 'gl.uniform4fv(location, arrayOf4Values); // or\ngl.uniform4f(location, v0, v1, v2, v3);';
  const intSetter = 'gl.uniform1i(location, value);';
  const intArraySetter = 'gl.uniform1iv(location, arrayOfValues);';
  const intVec2Setter = 'gl.uniform2iv(location, arrayOf2Values); // or\ngl.uniform2i(location, v0, v1)';
  const intVec3Setter = 'gl.uniform3iv(location, arrayOf3Values); // or\ngl.uniform3i(location, v0, v1, v2)';
  const intVec4Setter = 'gl.uniform4iv(location, arrayOf4Values); // or\ngl.uniform4i(location, v0, v1, v2, v3)';
  const uintSetter = 'gl.uniform1ui(location, value);';
  const uintArraySetter = 'gl.uniform1uiv(location, arrayOf1Value);';
  const uintVec2Setter = 'gl.uniform2uiv(location, arrayOf2Values); // or\ngl.uniform2ui(location, v0, v1)';
  const uintVec3Setter = 'gl.uniform3uiv(location, arrayOf3Values); // or\ngl.uniform3ui(location, v0, v1, v2)';
  const uintVec4Setter = 'gl.uniform4uiv(location, arrayOf4Values); // or\ngl.uniform4ui(location, v0, v1, v2, v3)';
  const floatMat2Setter = 'gl.uniformMatrix2fv(location, false, arrayOf4Values);';
  const floatMat3Setter = 'gl.uniformMatrix3fv(location, false, arrayOf9Values);';
  const floatMat4Setter = 'gl.uniformMatrix4fv(location, false, arrayOf16Values);';
  const floatMat23Setter = 'gl.uniformMatrix2x3fv(location, false, arrayOf6Values);';
  const floatMat32Setter = 'gl.uniformMatrix3x2fv(location, false, arrayOf6values);';
  const floatMat24Setter = 'gl.uniformMatrix2x4fv(location, false, arrayOf8Values);';
  const floatMat42Setter = 'gl.uniformMatrix4x2fv(location, false, arrayOf8Values);';
  const floatMat34Setter = 'gl.uniformMatrix3x4fv(location, false, arrayOf12Values);';
  const floatMat43Setter = 'gl.uniformMatrix4x3fv(location, false, arrayOf12Values);';
  const samplerSetter = 'gl.uniform1i(location, textureUnitIndex);\n// note: this only tells the shader\n// which texture unit to reference.\n// you still need to bind a texture\n// to that texture unit';
  const samplerArraySetter = 'gl.uniform1iv(location, arrayOfTextureUnitIndices);';

  typeMap[FLOAT]                         = { Type: Float32Array, size:  4, setter: floatSetter,      arraySetter: floatArraySetter, };
  typeMap[FLOAT_VEC2]                    = { Type: Float32Array, size:  8, setter: floatVec2Setter,  };
  typeMap[FLOAT_VEC3]                    = { Type: Float32Array, size: 12, setter: floatVec3Setter,  };
  typeMap[FLOAT_VEC4]                    = { Type: Float32Array, size: 16, setter: floatVec4Setter,  };
  typeMap[INT]                           = { Type: Int32Array,   size:  4, setter: intSetter,        arraySetter: intArraySetter, };
  typeMap[INT_VEC2]                      = { Type: Int32Array,   size:  8, setter: intVec2Setter,    };
  typeMap[INT_VEC3]                      = { Type: Int32Array,   size: 12, setter: intVec3Setter,    };
  typeMap[INT_VEC4]                      = { Type: Int32Array,   size: 16, setter: intVec4Setter,    };
  typeMap[UNSIGNED_INT]                  = { Type: Uint32Array,  size:  4, setter: uintSetter,       arraySetter: uintArraySetter, };
  typeMap[UNSIGNED_INT_VEC2]             = { Type: Uint32Array,  size:  8, setter: uintVec2Setter,   };
  typeMap[UNSIGNED_INT_VEC3]             = { Type: Uint32Array,  size: 12, setter: uintVec3Setter,   };
  typeMap[UNSIGNED_INT_VEC4]             = { Type: Uint32Array,  size: 16, setter: uintVec4Setter,   };
  typeMap[BOOL]                          = { Type: Uint32Array,  size:  4, setter: intSetter,        arraySetter: intArraySetter, };
  typeMap[BOOL_VEC2]                     = { Type: Uint32Array,  size:  8, setter: intVec2Setter,    };
  typeMap[BOOL_VEC3]                     = { Type: Uint32Array,  size: 12, setter: intVec3Setter,    };
  typeMap[BOOL_VEC4]                     = { Type: Uint32Array,  size: 16, setter: intVec4Setter,    };
  typeMap[FLOAT_MAT2]                    = { Type: Float32Array, size: 16, setter: floatMat2Setter,  };
  typeMap[FLOAT_MAT3]                    = { Type: Float32Array, size: 36, setter: floatMat3Setter,  };
  typeMap[FLOAT_MAT4]                    = { Type: Float32Array, size: 64, setter: floatMat4Setter,  };
  typeMap[FLOAT_MAT2x3]                  = { Type: Float32Array, size: 24, setter: floatMat23Setter, };
  typeMap[FLOAT_MAT2x4]                  = { Type: Float32Array, size: 32, setter: floatMat24Setter, };
  typeMap[FLOAT_MAT3x2]                  = { Type: Float32Array, size: 24, setter: floatMat32Setter, };
  typeMap[FLOAT_MAT3x4]                  = { Type: Float32Array, size: 48, setter: floatMat34Setter, };
  typeMap[FLOAT_MAT4x2]                  = { Type: Float32Array, size: 32, setter: floatMat42Setter, };
  typeMap[FLOAT_MAT4x3]                  = { Type: Float32Array, size: 48, setter: floatMat43Setter, };
  typeMap[SAMPLER_2D]                    = { Type: null,         size:  0, setter: samplerSetter,    arraySetter: samplerArraySetter, bindPoint: TEXTURE_2D,       };
  typeMap[SAMPLER_CUBE]                  = { Type: null,         size:  0, setter: samplerSetter,    arraySetter: samplerArraySetter, bindPoint: TEXTURE_CUBE_MAP, };
  typeMap[SAMPLER_3D]                    = { Type: null,         size:  0, setter: samplerSetter,    arraySetter: samplerArraySetter, bindPoint: TEXTURE_3D,       };
  typeMap[SAMPLER_2D_SHADOW]             = { Type: null,         size:  0, setter: samplerSetter,    arraySetter: samplerArraySetter, bindPoint: TEXTURE_2D,       };
  typeMap[SAMPLER_2D_ARRAY]              = { Type: null,         size:  0, setter: samplerSetter,    arraySetter: samplerArraySetter, bindPoint: TEXTURE_2D_ARRAY, };
  typeMap[SAMPLER_2D_ARRAY_SHADOW]       = { Type: null,         size:  0, setter: samplerSetter,    arraySetter: samplerArraySetter, bindPoint: TEXTURE_2D_ARRAY, };
  typeMap[SAMPLER_CUBE_SHADOW]           = { Type: null,         size:  0, setter: samplerSetter,    arraySetter: samplerArraySetter, bindPoint: TEXTURE_CUBE_MAP, };
  typeMap[INT_SAMPLER_2D]                = { Type: null,         size:  0, setter: samplerSetter,    arraySetter: samplerArraySetter, bindPoint: TEXTURE_2D,       };
  typeMap[INT_SAMPLER_3D]                = { Type: null,         size:  0, setter: samplerSetter,    arraySetter: samplerArraySetter, bindPoint: TEXTURE_3D,       };
  typeMap[INT_SAMPLER_CUBE]              = { Type: null,         size:  0, setter: samplerSetter,    arraySetter: samplerArraySetter, bindPoint: TEXTURE_CUBE_MAP, };
  typeMap[INT_SAMPLER_2D_ARRAY]          = { Type: null,         size:  0, setter: samplerSetter,    arraySetter: samplerArraySetter, bindPoint: TEXTURE_2D_ARRAY, };
  typeMap[UNSIGNED_INT_SAMPLER_2D]       = { Type: null,         size:  0, setter: samplerSetter,    arraySetter: samplerArraySetter, bindPoint: TEXTURE_2D,       };
  typeMap[UNSIGNED_INT_SAMPLER_3D]       = { Type: null,         size:  0, setter: samplerSetter,    arraySetter: samplerArraySetter, bindPoint: TEXTURE_3D,       };
  typeMap[UNSIGNED_INT_SAMPLER_CUBE]     = { Type: null,         size:  0, setter: samplerSetter,    arraySetter: samplerArraySetter, bindPoint: TEXTURE_CUBE_MAP, };
  typeMap[UNSIGNED_INT_SAMPLER_2D_ARRAY] = { Type: null,         size:  0, setter: samplerSetter,    arraySetter: samplerArraySetter, bindPoint: TEXTURE_2D_ARRAY, };

  return function(type) {
    return typeMap[type];
  };

  }());

  function createProgramUniforms(parent, gl, program) {
    const tbody = createTable(parent, ['name', 'value']);

    let locations = [];
    let numUniforms;

    const update = () => {
      locations.forEach((location, ndx) => {
        const cell = tbody.rows[ndx].cells[1];
        updateElem(cell, formatUniformValue(gl.getUniform(program, location)));
      });
    };

    const scan = () => {
      locations = [];
      numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
      tbody.innerHTML = '';
      flash(tbody);

      for (let ii = 0; ii < numUniforms; ++ii) {
        const uniformInfo = gl.getActiveUniform(program, ii);
        if (isBuiltIn(uniformInfo)) {
            continue;
        }
        let name = uniformInfo.name;
        // remove the array suffix.
        if (name.substr(-3) === "[0]") {
          name = name.substr(0, name.length - 3);
        }
        locations.push(gl.getUniformLocation(program, name));
        const info = getUniformInfo(uniformInfo.type);
        const help = helpToMarkdown(`---js\nconst location = gl.getUniformLocation(\n    program,\n    '${name}');\ngl.useProgram(program); // set current program\n${info.setter}\n---`);

        const tr = addElem('tr', tbody);
        addElem('td', tr, {textContent: name, dataset: {help}});
        addElem('td', tr, {
          dataset: {help},
        });
      }
      update();
    };

    scan();
    update();

    return {
      elem: tbody,
      scan,
      update,
    };
  }

  function setName(elem, name) {
    const nameElem = elem.querySelector('.name');
    nameElem.textContent = `${nameElem.textContent}[${name}]`;
  }

  function createShaderDisplay(parent, name, shader) {
    const type = gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.VERTEX_SHADER ? 'vertex' : 'fragment';

    const shElem = createTemplate(parent, `#${type}-shader-template`);
    setName(shElem, name);

    const sourceExpander = createExpander(shElem, 'source');
    const preElem = addElem('pre', sourceExpander);

    const updateSource = () => {
      preElem.innerHTML = '';
      const codeElem = addElem('code', preElem, {className: 'lang-glsl'});
      codeElem.textContent = gl.getShaderSource(shader);
      hljs.highlightBlock(codeElem);
      expand(sourceExpander);
    };

    const queryFn = state => {
      const {pname} = state;
      const value = gl.getShaderParameter(shader, gl[pname]);
      return value;
    };

    const stateTable = createStateTable(shaderState, shElem, 'state', queryFn);
    expand(stateTable);
    makeDraggable(shElem);

    return {
      elem: shElem,
      updateSource,
      updateState: () => {
        updateStateTable(shaderState, stateTable, queryFn);
      },
    };
  }

  function createProgramDisplay(parent, name, program) {
    const prgElem = createTemplate(parent, '#program-template');
    setName(prgElem, name);

    const shaderExpander = createExpander(prgElem, 'attached shaders');
    const shadersTbody = createTable(shaderExpander, []);

    let arrows = [];
    let oldShaders = [];
    let newShaders;

    const updateAttachedShaders = () => {
      expand(shaderExpander);
      shadersTbody.innerHTML = '';

      arrows.forEach(arrow => arrowManager.remove(arrow));

      newShaders = gl.getAttachedShaders(program);

      // sort so VERTEX_SHADER is first.
      newShaders.sort((a, b) => {
        const aType = gl.getShaderParameter(a, gl.SHADER_TYPE);
        const bType = gl.getShaderParameter(b, gl.SHADER_TYPE);
        return aType < bType;
      });

      for (const shader of newShaders) {
        const tr = addElem('tr', shadersTbody);
        addElem('td', tr, {
            className: oldShaders.indexOf(shader) >= 0 ? '' : 'flash',
            textContent: formatWebGLObject(shader),
        });
        const targetInfo = getWebGLObjectInfo(shader);
        if (!targetInfo.deleted) {
          arrows.push(arrowManager.add(
              tr, 
              targetInfo.ui.elem.querySelector('.name'),
              getColorForWebGLObject(shader, targetInfo.ui.elem)));
        }
      }

      oldShaders = newShaders;
    };

    const attribExpander = createExpander(prgElem, 'attribute info', {
      dataset: {
        hint: 'attributes are user defined. Their values come from buffers as specified in a *vertex array*.',
      },
    });
    const uniformExpander = createExpander(prgElem, 'uniforms', {
      dataset: {
        hint: 'uniform values are user defined program state. The locations and values are different for each program.',
      },
    });


    expand(attribExpander);
    expand(uniformExpander);

    const attribUI = createProgramAttributes(attribExpander, gl, program);
    const uniformUI = createProgramUniforms(uniformExpander, gl, program);

    const queryFn = state => {
      const {pname} = state;
      const value = gl.getProgramParameter(program, gl[pname]);
      return value;
    };

    const stateTable = createStateTable(programState, prgElem, 'state', queryFn);
    expand(stateTable);

    makeDraggable(prgElem);

    return {
      elem: prgElem,
      updateAttachedShaders,
      updateState: () => {
        updateStateTable(programState, stateTable, queryFn);
      },
      scanAttributes: attribUI.scan,
      scanUniforms: uniformUI.scan,
      updateUniforms: uniformUI.update,
    };
  }

  const maxAttribs = 8;
  function createVertexArrayDisplay(parent, name, /* webglObject */) {
    const vaElem = createTemplate(parent, '#vertex-array-template');
    setName(vaElem, name);
    const vaoNote = helpToMarkdown(`
      note: the current vertex array can be set with the
      [--OES_vertex_array_object--](https://www.khronos.org/registry/webgl/extensions/OES_vertex_array_object/)
      extension. Otherwise there is only the 1 default vertex array in WebGL 1.0.
    `);
    const attrExpander = createExpander(vaElem.querySelector('.state-table'), 'attributes');
    expand(attrExpander);
    const table = createTemplate(attrExpander, '#vertex-attributes-template');
    const attrsElem = table.querySelector('tbody');

    for (let i = 0; i < maxAttribs; ++i) {
      const tr = addElem('tr', attrsElem);

      addElem('td', tr, {
        dataset: {
          help: helpToMarkdown(`
          * --true-- this attribute uses data from a buffer.
          * --false-- it uses --value--.

          ---js
          const index = gl.getAttribLocation(program, 'someAttrib'); // ${i}
          gl.enableVertexAttribArray(index);   // turn on
          gl.disableVertexAttribArray(index);  // turn off
          ---

          ${vaoNote}`),
        },
      });
      addElem('td', tr, {
        className: 'used-when-disabled',
        dataset: {
          help: helpToMarkdown(`
          The value used if this attribute is disabled.

          ---js
          const index = gl.getAttribLocation(program, 'someAttrib'); // ${i}
          gl.vertexAttrib4fv(index, [1, 2, 3, 4]);
          ---

          ${vaoNote}`),
        },
      });
      addElem('td', tr, {
        className: 'used-when-enabled',
        dataset: {
          help: helpToMarkdown(`
          Number of values to pull from buffer per vertex shader iteration

          ---js
          const index = gl.getAttribLocation(program, 'someAttrib'); // ${i}
          gl.vertexAttribPointer(index, SIZE, type, normalize, stride, offset);
          ---

          ${vaoNote}`),
        },
      });
      addElem('td', tr, {
        className: 'used-when-enabled',
        dataset: {
          help: helpToMarkdown(`
          The type of the data to read from the buffer. 
          --BYTE--, --UNSIGNED_BYTE--, --SHORT--, --UNSIGNED_SHORT--,
          --INT--, --UNSIGNED_INT--, --FLOAT--

          ---js
          const index = gl.getAttribLocation(program, 'someAttrib'); // ${i}
          gl.vertexAttribPointer(index, size, TYPE, normalize, stride, offset);
          ---

          ${vaoNote}`),
        },
      });
      addElem('td', tr, {
        className: 'used-when-enabled',
        dataset: {
          help: helpToMarkdown(`
          true = use the value as is
          false = convert the value to 0.0 to 1.0 for UNSIGNED types
          and -1.0 to 1.0 for signed types.

          ---js
          const index = gl.getAttribLocation(program, 'someAttrib'); // ${i}
          gl.vertexAttribPointer(index, size, type, NORMALIZE, stride, offset);
          ---

          ${vaoNote}`),
        },
      });
      addElem('td', tr, {
        className: 'used-when-enabled',
        dataset: {
          help: helpToMarkdown(`
          how many bytes to advance in the buffer per vertex shader iteration
          to get to the next value for this attribute. 0 is a special value
          that means WebGL will figure out the stride from the --type-- and
          --size-- arguments.
          
          ---js
          const index = gl.getAttribLocation(program, 'someAttrib'); // ${i}
          gl.vertexAttribPointer(index, size, type, normalize, STRIDE, offset);
          ---

          ${vaoNote}`),
        },
      });
      addElem('td', tr, {
        className: 'used-when-enabled',
        dataset: {
          help: helpToMarkdown(`
          The offset in bytes where the data for this attribute starts in the buffer.
          
          ---js
          const index = gl.getAttribLocation(program, 'someAttrib'); // ${i}
          gl.vertexAttribPointer(index, size, type, normalize, stride, OFFSET);
          ---

          ${vaoNote}`),
        },
      });
      addElem('td', tr, {
        className: 'used-when-enabled',
        dataset: {
          help: helpToMarkdown(`
          Used with the [--ANGLE_instanced_arrays--](https://www.khronos.org/registry/webgl/extensions/ANGLE_instanced_arrays/)  extension.
          If --divisor-- === 0 then this attribute advances normally, once each vertex shader iteration.
          If --divisor-- > 0 then this attribute advances once each --divisor-- instances.
          
          ---js
          const ext = gl.getExtension('ANGLE_instanced_arrays');
          const index = gl.getAttribLocation(program, 'someAttrib'); // ${i}
          ext.vertexAttribDivisor(index, divisor);
          ---

          ${vaoNote}`),
        },
      });
      addElem('td', tr, {
        className: 'used-when-enabled',
        dataset: {
          help: helpToMarkdown(`
          The buffer this attribute will pull data from. This gets set
          implicitly when calling --gl.vertexAttribPointer-- from the
          currently bound --ARRAY_BUFFER--
          
          ---js
          const index = gl.getAttribLocation(program, 'someAttrib'); // ${i}

          // bind someBuffer to ARRAY_BUFFER
          gl.bindBuffer(gl.ARRAY_BUFFER, someBuffer);

          // someBuffer will get bound to this attribute
          gl.vertexAttribPointer(index, size, type, normalize, stride, offset);
          ---

          ${vaoNote}`),
        },
      });
    }

    const formatters = [
      formatBoolean,      // enable
      formatUniformValue, // value
      formatUniformValue, // size
      formatEnum,         // type
      formatBoolean,      // normalize
      formatUniformValue, // stride
      formatUniformValue, // offset
      formatUniformValue, // divisor
      formatWebGLObject,  // buffer
    ];
    const arrows = [];

    const updateAttributes = () => {
      for (let i = 0; i < maxAttribs; ++i) {
        const row = attrsElem.rows[i];
        const data = [
          gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_ENABLED),
          gl.getVertexAttrib(i, gl.CURRENT_VERTEX_ATTRIB),
          gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_SIZE),
          gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_TYPE),
          gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_NORMALIZED),
          gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_STRIDE),
          gl.getVertexAttribOffset(i, gl.VERTEX_ATTRIB_ARRAY_POINTER),
          gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_DIVISOR),
          gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING),
        ];
        if (data[0]) {
          row.classList.add('attrib-enable');
        } else {
          row.classList.remove('attrib-enable');
        }
        data.forEach((value, cellNdx) => {
          const cell = row.cells[cellNdx];
          const newValue = formatters[cellNdx](value);
          if (updateElem(cell, newValue)) {
            if (cellNdx === 8) {  // FIXME
              const oldArrow = arrows[i];
              if (oldArrow) {
                arrowManager.remove(oldArrow);
                arrows[i] = null;
              }
              if (value) {
                const targetInfo = getWebGLObjectInfo(value);
                if (!targetInfo.deleted) {
                  arrows[i] = arrowManager.add(
                      cell,
                      targetInfo.ui.elem.querySelector('.name'),
                      getColorForWebGLObject(value, targetInfo.ui.elem));
                }
              }
            }
          }
        });
      }
    };
    updateAttributes();

    const vaQueryFn = state => {
      const {pname} = state;
      const value = gl.getParameter(gl[pname]);
      return value;
    };

    const stateTable = createStateTable(vertexArrayState, vaElem.querySelector('.state-table'), 'state', vaQueryFn);
    expand(stateTable);
    makeDraggable(vaElem);

    return {
      elem: vaElem,
      updateAttributes,
      updateState: () => {
        updateStateTable(vertexArrayState, stateTable, vaQueryFn);
      },
    };
  }

  function createBufferDisplay(parent, name /*, webglObject */) {
    const bufElem = createTemplate(parent, '#buffer-template');
    setName(bufElem, name);
    const dataExpander = createExpander(bufElem, 'data');
    const dataElem = addElem('code', dataExpander, {className: 'data'});

    const updateData = (dataOrSize) => {
      const maxValues = 9;
      const data = typeof dataOrSize === 'number' ? new Array(maxValues).fill(0) : dataOrSize;
      expand(dataExpander);
      flash(dataElem);
      const value = formatUniformValue(Array.from(data).slice(0, maxValues));
      dataElem.textContent = `${value}${data.length > maxValues ? ', ...' : ''}`;
    };

    makeDraggable(bufElem);
    return {
      elem: bufElem,
      updateData,
    };
  }

  function createTextureDisplay(parent, name, texture, imgHref) {
    const texElem = createTemplate(parent, '#texture-template');
    setName(texElem, name);

    const mipsExpander = createExpander(texElem, 'mips');
    const mipsOuterElem = addElem('div', mipsExpander);
    const mipsElem = addElem('div', mipsOuterElem, {className: 'mips'});
    const numMips = 8;
    for (let i = 0; i < numMips; ++i) {
      const size = 2 ** (numMips - i - 1);
      addElem('div', mipsElem, {
        className: `mip${i}`,
        style: { backgroundImage: `url(${imgHref})` },
        dataset: {
          help: helpToMarkdown(`
            Uploading data

            ---js
            const target = gl.TEXTURE_2D;
            const level = ${i};
            const internalFormat = gl.RGBA;
            const width = ${size};
            const height = ${size};
            const format = gl.RGBA;
            const type = gl.UNSIGNED_BYTE;
            gl.texImage2D(
                target, level, internalFormat,
                width, height, 0, format, type,
                someUnit8ArrayWith${size}x${size}x4Values);
            ---

            Uploading an image/canvas/video. The image must
            have finished downloading.

            ---js
            const target = gl.TEXTURE_2D;
            const level = ${i};
            const internalFormat = gl.RGBA;
            const format = gl.RGBA;
            const type = gl.UNSIGNED_BYTE;
            gl.texImage2D(
                target, level, internalFormat,
                format, type, imageCanvasVideoElem);
            ---

            mips > 0 can be generated by calling
            --gl.generateMipmap(gl.TEXTURE_2D);--

            ${activeTexNote}`),
        },
      });
    }

    const updateData = () => {};

    const queryFn = state => {
      const {pname} = state;
      const info = getWebGLObjectInfo(texture);
      const target = info.target;
      const value = gl.getTexParameter(target, gl[pname]);
      return value;
    };

    const stateTable = createStateTable(textureState, texElem, 'texture state', queryFn, false);

    expand(mipsExpander);
    expand(stateTable);
    makeDraggable(texElem);

    return {
      elem: texElem,
      updateData,
      updateState: () => {
        updateStateTable(textureState, stateTable, queryFn);
      },
    };
  }

  function createTextureUnits(parent, maxUnits = 8) {
    const expander = createExpander(parent, 'Texture Units');
    const tbody = createTable(expander, ['2D', 'CUBE_MAP']);
    const arrows = [];
    let activeTextureUnit = 0;
 
    for (let i = 0; i < maxUnits; ++i) {
      arrows.push({});
      const tr = addElem('tr', tbody);
      addElem('td', tr, {
        textContent: 'null',
        dataset: {
          help: helpToMarkdown(`
            bind a texture to this unit with

            ---js
            gl.activeTexture(gl.TEXTURE0 + ${i});
            gl.bindTexture(gl.TEXTURE_2D, someTexture);
            ---
          `),
        },
      });
      addElem('td', tr, {
        textContent: 'null',
        dataset: {
          help: helpToMarkdown(`
            bind a texture to this unit with

            ---js
            gl.activeTexture(gl.TEXTURE0 + ${i});
            gl.bindTexture(gl.TEXTURE_CUBE_MAP, someTexture);
            ---
          `),
        },
      });
    } 

    const targets = [gl.TEXTURE_BINDING_2D, gl.TEXTURE_BINDING_CUBE_MAP];
    const updateCurrentTextureUnit = () => {
      const unit = gl.getParameter(gl.ACTIVE_TEXTURE) - gl.TEXTURE0;
      const row = tbody.rows[unit];
      targets.forEach((target, colNdx) => {
        const cell = row.cells[colNdx];
        const texture = gl.getParameter(target);
        if (updateElem(cell, formatWebGLObject(texture))) {
          const oldArrow = arrows[unit][target];
          if (oldArrow) {
            arrowManager.remove(oldArrow);
            arrows[unit][target] = null;
          }
          if (texture) {
            const targetInfo = getWebGLObjectInfo(texture);
            if (!targetInfo.deleted) {
              arrows[unit][target] = arrowManager.add(
                  cell,
                  targetInfo.ui.elem.querySelector('.name'),
                  getColorForWebGLObject(texture, targetInfo.ui.elem));
            }
          }
        }
      });
    };

    const updateActiveTextureUnit = () => {
      tbody.rows[activeTextureUnit].classList.remove('active-texture-unit');
      activeTextureUnit = gl.getParameter(gl.ACTIVE_TEXTURE) - gl.TEXTURE0;
      tbody.rows[activeTextureUnit].classList.add('active-texture-unit');
    };
    updateActiveTextureUnit();

    return {
      elem: expander,
      updateCurrentTextureUnit,
      updateActiveTextureUnit,
    };
  }

  function expand(elem) {
    if (elem.classList.contains('expander')) {
      elem.classList.add('open');
    } else {
      elem.querySelector('.expander').classList.add('open');
    }
    return elem;
  }

  function globalStateQuery(state) {
    const {pname} = state;
    const value = gl.getParameter(gl[pname]);
    if (gl.getError()) {
      debugger;  // eslint-disable-line no-debugger
    }
    return value;
  }
  const defaultVAOInfo = {
    ui: createVertexArrayDisplay(diagramElem, '*default*', null),
  };

  const settersToWrap = {};

  function createStateUI(stateTable, parent, name, queryFn) {
    const elem = createStateTable(stateTable, parent, name, queryFn);
    const updateState = () => {
      updateStateTable(stateTable, elem, queryFn);
    };

    for (const state of stateTable) {
      const setters = Array.isArray(state.setter) ? state.setter : [state.setter];
      for (const setter of setters) {
        if (!settersToWrap[setter]) {
          settersToWrap[setter] = [];
        }
        const stateUpdaters = settersToWrap[setter];
        if (stateUpdaters.indexOf(updateState) < 0) {
          stateUpdaters.push(updateState);
        }
      }
    }
    return {
      elem,
      updateState,
    };
  }
  const globalStateElem = document.querySelector('#global-state');
  const globalUI = {
    commonState: createStateUI(globalState.commonState, globalStateElem, 'common state', globalStateQuery),
    textureUnits: createTextureUnits(globalStateElem, 8),
    clearState: createStateUI(globalState.clearState, globalStateElem, 'clear state', globalStateQuery),
    depthState: createStateUI(globalState.depthState, globalStateElem, 'depth state', globalStateQuery),
    blendState: createStateUI(globalState.blendState, globalStateElem, 'blend state', globalStateQuery),
    miscState: createStateUI(globalState.miscState, globalStateElem, 'misc state', globalStateQuery),
    stencilState: createStateUI(globalState.stencilState, globalStateElem, 'stencil state', globalStateQuery),
    polygonState: createStateUI(globalState.polygonState, globalStateElem, 'polygon state', globalStateQuery),
  };
  expand(globalUI.textureUnits.elem);
  expand(globalUI.commonState.elem);
  expand(globalUI.clearState.elem);
  expand(globalUI.depthState.elem);

  makeDraggable(globalStateElem);
  makeDraggable(document.querySelector('#canvas'));
  moveToFront(defaultVAOInfo.ui.elem.parentElement);
  arrowManager.update();

  function wrapFn(fnName, fn) {
    gl[fnName] = function(origFn) {
      if (!origFn) {
        debugger;  // eslint-disable-line no-debugger
      }
      return function(...args) {
        return fn.call(this, origFn, ...args);
      };
    }(gl[fnName]);
  }

  function wrapCreationFn(fnName, uiFactory) {
    wrapFn(fnName, function(origFn, ...args) {
      const webglObject = origFn.call(this, ...args);
      const name = stepper.guessIdentifierOfCurrentLine();
      addWebGLObjectInfo(webglObject, {
        name,
        ui: uiFactory(name, webglObject),
      });
      return webglObject;
    });
  }

  function wrapDeleteFn(fnName) {
    wrapFn(fnName, function(origFn, webglObject) {
      origFn.call(this, webglObject);
      const info = getWebGLObjectInfo(webglObject);
      info.deleted = true;
      const {elem} = info.ui;
      elem.parentElement.removeChild(elem);
    });
  }

  wrapCreationFn('createTexture', (name, webglObject) => {
    return createTextureDisplay(diagramElem, name, webglObject, '/webgl/resources/f-texture.png');
  });
  wrapCreationFn('createBuffer', (name, webglObject) => {
    return createBufferDisplay(diagramElem, name, webglObject);
  });
  wrapCreationFn('createShader', (name, webglObject) => {
    return createShaderDisplay(diagramElem, name, webglObject);
  });
  wrapCreationFn('createProgram', (name, webglObject) => {
    return createProgramDisplay(diagramElem, name, webglObject);
  });
  wrapDeleteFn('deleteTexture');
  wrapDeleteFn('deleteBuffer');
  wrapDeleteFn('deleteShader');
  wrapDeleteFn('deleteProgram');

  for (const [fnName, stateUpdaters] of Object.entries(settersToWrap)) {
    wrapFn(fnName, function(origFn, ...args) {
      origFn.call(this, ...args);
      stateUpdaters.forEach(updater => updater());
    });
  }

  Object.keys(WebGLRenderingContext.prototype)
      .filter(name => /^uniform(\d|Matrix)/.test(name))
      .forEach((fnName) => {
        wrapFn(fnName, function(origFn, ...args) {
          origFn.call(this, ...args);
          const program = gl.getParameter(gl.CURRENT_PROGRAM);
          const {ui} = getWebGLObjectInfo(program);
          ui.updateUniforms();
        });
      });

  wrapFn('bindTexture', function(origFn, target, texture) {
    origFn.call(this, target, texture);
    const info = getWebGLObjectInfo(texture);
    if (!info.target) {
      info.target = target;
      info.ui.updateState();
    }
    globalUI.textureUnits.updateCurrentTextureUnit(target);
  });
  function getCurrentTextureForTarget(target) {
    if (target === gl.TEXTURE_CUBE_MAP) {
      return gl.getParameter(gl.TEXTURE_BINDING_CUBE_MAP);
    }
    if (target === gl.TEXTURE_2D) {
      return gl.getParameter(gl.TEXTURE_BINDING_2D);
    }
    throw new Error(`unknown target: ${target}`);
  }
  wrapFn('texParameteri', function(origFn, target, ...args) {
    origFn.call(this, target, ...args);
    const texture = getCurrentTextureForTarget(target);
    const {ui} = getWebGLObjectInfo(texture);
    ui.updateState();
  });
  wrapFn('shaderSource', function(origFn, shader, source) {
    origFn.call(this, shader, source);
    const {ui} = getWebGLObjectInfo(shader);
    ui.updateSource();
  });

  wrapFn('attachShader', function(origFn, program, shader) {
    origFn.call(this, program, shader);
    const {ui} = getWebGLObjectInfo(program);
    ui.updateAttachedShaders();
  });

  wrapFn('compileShader', function(origFn, shader) {
    origFn.call(this, shader);
    const {ui} = getWebGLObjectInfo(shader);
    ui.updateState();
  });

  wrapFn('linkProgram', function(origFn, program) {
    origFn.call(this, program);
    const {ui} = getWebGLObjectInfo(program);
    ui.updateState();
    if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
      ui.scanAttributes();
      ui.scanUniforms();
    }
  });
  wrapFn('bindBuffer', function(origFn, bindPoint, buffer) {
    origFn.call(this, bindPoint, buffer);
    if (bindPoint === gl.ARRAY_BUFFER) {
      globalUI.commonState.updateState();
    } else {
      const {ui} = getCurrentVAOInfo();
      ui.updateState();
    }
  });
  wrapFn('bufferData', function(origFn, bindPoint, dataOrSize, hint) {
    origFn.call(this, bindPoint, dataOrSize, hint);
    const buffer = gl.getParameter(bindPoint === gl.ARRAY_BUFFER ? gl.ARRAY_BUFFER_BINDING : gl.ELEMENT_ARRAY_BUFFER_BINDING);
    const {ui} = getWebGLObjectInfo(buffer);
    ui.updateData(dataOrSize);
  });
  function getCurrentVAOInfo() {
    //const vertexArray = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    //const info = vertexArray ? webglObjects.get(vertexArray) : defaultVAOInfo;
    return defaultVAOInfo;
  }
  wrapFn('enableVertexAttribArray', function(origFn, ...args) {
    origFn.call(this, ...args);
    const {ui} = getCurrentVAOInfo();
    ui.updateAttributes();
  });
  wrapFn('disableVertexAttribArray', function(origFn, ...args) {
    origFn.call(this, ...args);
    const {ui} = getCurrentVAOInfo();
    ui.updateAttributes();
  });
  wrapFn('vertexAttribPointer', function(origFn, ...args) {
    origFn.call(this, ...args);
    const {ui} = getCurrentVAOInfo();
    ui.updateAttributes();
  });
  wrapFn('activeTexture', function(origFn, unit) {
    origFn.call(this, unit);
    globalUI.textureUnits.updateActiveTextureUnit();
  });

  function handleResizes() {
    arrowManager.update();
  }

  stepper.init(codeElem, document.querySelector('#js').text, {
    onAfter: handleResizes,
  });

  window.addEventListener('resize', handleResizes);
}
main();