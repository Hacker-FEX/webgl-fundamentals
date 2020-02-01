/* eslint no-undef: "error" */

/* global hljs, gl */

import {
  addElem,
  createTable,
  createTemplate,
  flash,
  formatUniformValue,
  getColorForWebGLObject,
  helpToMarkdown,
  setName,
} from './webgl-state-diagram-utils.js';

import {
  formatWebGLObject,
  getWebGLObjectInfo,
  getWebGLObjectInfoOrDefaultVAO,
} from './webgl-state-diagram-context-wrapper.js';

import {
  collapseOrExpand,
  createExpander,
  flashSelfAndExpanderIfClosed,
  expand,
  makeDraggable,
  updateElemAndFlashExpanderIfClosed,
} from './webgl-state-diagram-ui.js';

import {
  createStateTable,
  updateStateTable,
} from './webgl-state-diagram-state-table.js';

import {arrowManager} from './webgl-state-diagram-arrows.js';
import {
  globals,
} from './webgl-state-diagram-globals.js';

function isBuiltIn(info) {
  const name = info.name;
  return name.startsWith("gl_") || name.startsWith("webgl_");
}

function createProgramAttributes(parent, gl, program) {
  const tbody = createTable(parent, ['name', 'location']);
  const arrows = [];

  const scan = () => {
    tbody.innerHTML = '';
    flash(tbody);
    arrows.forEach(arrow => arrowManager.remove(arrow));

    const vao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    const vaoInfo = getWebGLObjectInfoOrDefaultVAO(vao);
    const isCurrent = gl.getParameter(gl.CURRENT_PROGRAM) === program;

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

      if (isCurrent) {
        const target = vaoInfo.ui.elem.querySelector('tbody').rows[index]; /*.cells[bindPointIndex]; */
        arrows.push(arrowManager.add(
            tr,
            target,
            getColorForWebGLObject(vao, target, index / 8),
            {startDir: 'right', endDir: 'right', attrs: {'stroke-dasharray': '2 4'}}));
      }
    }
  };

  scan(true);

  return {
    elem: tbody,
    scan,
    update: scan,
  };
}

const {getUniformTypeInfo} = (function() {

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

// this is the wrong place for this data. Should be asking the texture unit display
const bindPointToIndex = {};
bindPointToIndex[TEXTURE_2D] = 0;
bindPointToIndex[TEXTURE_CUBE_MAP] = 1;
bindPointToIndex[TEXTURE_3D] = 2;
bindPointToIndex[TEXTURE_2D_ARRAY] = 3;

return {
  getUniformTypeInfo(type) {
    return typeMap[type];
  },
  getIndexOfBindPoint(bindPoint) {
    return bindPointToIndex[bindPoint];
  },
};

}());

function createProgramUniforms(parent, gl, program) {
  const tbody = createTable(parent, ['name', 'value']);

  let locationInfos = [];
  let numUniforms;

  const update = (initial) => {
    const isCurrent = gl.getParameter(gl.CURRENT_PROGRAM) === program;

    locationInfos.forEach((locationInfo, ndx) => {
      const {location, uniformTypeInfo} = locationInfo;
      const cell = tbody.rows[ndx].cells[1];
      const value = gl.getUniform(program, location);
      updateElemAndFlashExpanderIfClosed(cell, formatUniformValue(value), !initial);
      const bindPoint = uniformTypeInfo.bindPoint;
      if (bindPoint) {
        if (locationInfo.arrow) {
          arrowManager.remove(locationInfo.arrow);
        }
        if (isCurrent) {
          // const bindPointIndex = getIndexOfBindPoint(bindPoint);
          const target = globals.globalUI.textureUnits.elem.querySelector('tbody').rows[value]; /*.cells[bindPointIndex]; */
          locationInfo.arrow =  arrowManager.add(
                tbody.rows[ndx].cells[0],
                target,
                getColorForWebGLObject(null, target),
                {startDir: 'left', endDir: 'right', attrs: {'stroke-dasharray': '2 4'}});
        }
      }
    });
  };

  const scan = () => {
    locationInfos.forEach(({arrow}) => {
      if (arrow) {
        arrowManager.remove(arrow);
      }
    });
    locationInfos = [];
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
      const uniformTypeInfo = getUniformTypeInfo(uniformInfo.type);
      const help = helpToMarkdown(`---js\nconst location = gl.getUniformLocation(\n    program,\n    '${name}');\ngl.useProgram(program); // set current program\n${uniformTypeInfo.setter}\n---`);
      locationInfos.push({
        location: gl.getUniformLocation(program, name),
        uniformInfo,
        uniformTypeInfo,
      });

      const tr = addElem('tr', tbody);
      addElem('td', tr, {textContent: name, dataset: {help}});
      addElem('td', tr, {
        dataset: {help},
      });
    }
    update();
  };

  scan();
  update(true);

  return {
    elem: tbody,
    scan,
    update,
  };
}

export function createShaderDisplay(parent, name, shader) {
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

  const stateTable = createStateTable(globals.stateTables.shaderState, shElem, 'state', queryFn);
  expand(stateTable);
  makeDraggable(shElem);

  return {
    elem: shElem,
    updateSource,
    updateState: () => {
      updateStateTable(globals.stateTables.shaderState, stateTable, queryFn);
    },
  };
}

export function createProgramDisplay(parent, name, program) {
  const prgElem = createTemplate(parent, '#program-template');
  setName(prgElem, name);

  const shaderExpander = createExpander(prgElem, 'attached shaders');
  const shadersTbody = createTable(shaderExpander, []);

  let arrows = [];
  let oldShaders = [];
  let newShaders;

  const updateAttachedShaders = () => {
    shadersTbody.innerHTML = '';

    arrows.forEach(arrow => arrowManager.remove(arrow));

    newShaders = gl.getAttachedShaders(program);
    collapseOrExpand(shaderExpander, newShaders.length > 0);

    // sort so VERTEX_SHADER is first.
    newShaders.sort((a, b) => {
      const aType = gl.getShaderParameter(a, gl.SHADER_TYPE);
      const bType = gl.getShaderParameter(b, gl.SHADER_TYPE);
      return aType < bType;
    });

    for (const shader of newShaders) {
      const tr = addElem('tr', shadersTbody);
      const td = addElem('td', tr, {
          textContent: formatWebGLObject(shader),
      });
      if (oldShaders.indexOf(shader) < 0) {
        flashSelfAndExpanderIfClosed(td);
      }
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

  const stateTable = createStateTable(globals.stateTables.programState, prgElem, 'state', queryFn);
  expand(stateTable);

  makeDraggable(prgElem);

  return {
    elem: prgElem,
    updateAttachedShaders,
    updateState: () => {
      updateStateTable(globals.stateTables.programState, stateTable, queryFn);
    },
    scanAttributes: attribUI.scan,
    updateAttributes: attribUI.update,
    scanUniforms: uniformUI.scan,
    updateUniforms: uniformUI.update,
  };
}