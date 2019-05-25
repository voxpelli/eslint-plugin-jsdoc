import debugModule from 'debug';

const debug = debugModule('requireExportJsdoc');

const createNode = function () {
  return {
    props: {}
  };
};

const getSymbolValue = function (symbol) {
  if (!symbol) {
    return null;
  }
  if (symbol.type === 'literal') {
    return symbol.value.value;
  }

  return null;
};

const getIdentifier = function (node, globals, scope, opts) {
  if (opts.simpleIdentifier) {
    // Type is Identier for noncomputed properties
    const identifierLiteral = createNode();
    identifierLiteral.type = 'literal';
    identifierLiteral.value = {value: node.name};

    return identifierLiteral;
  }

  const block = scope || globals;

  // As scopes are not currently supported, they are not traversed upwards recursively
  if (block.props[node.name]) {
    return block.props[node.name];
  }
  if (globals.props[node.name]) {
    return globals.props[node.name];
  }

  return null;
};

let createSymbol = null;
const getSymbol = function (node, globals, scope, opt) {
  const opts = opt || {};
  let block = scope;
  switch (node.type) {
  case 'Identifier': {
    return getIdentifier(node, globals, scope, opts);
  } case 'MemberExpression': {
    const obj = getSymbol(node.object, globals, scope, opts);
    const propertySymbol = getSymbol(node.property, globals, scope, {simpleIdentifier: !node.computed});
    const propertyValue = getSymbolValue(propertySymbol);

    if (obj && propertyValue && obj.props[propertyValue]) {
      block = obj.props[propertyValue];

      return block;
    }
    if (opts.createMissingProps && propertyValue) {
      obj.props[propertyValue] = createNode();

      return obj.props[propertyValue];
    }
    debug('MemberExpression: Missing property ' + node.property.name);

    return null;
  } case 'ClassDeclaration': case 'FunctionExpression': case 'FunctionDeclaration': case 'ArrowFunctionExpression': {
    const val = createNode();
    val.props.prototype = createNode();
    val.props.prototype.type = 'object';
    val.type = 'object';
    val.value = node;

    return val;
  } case 'AssignmentExpression': {
    return createSymbol(node.left, globals, node.right, scope, opts);
  } case 'ClassBody': {
    const val = createNode();
    node.body.forEach((method) => {
      val.props[method.key.name] = createNode();
      val.props[method.key.name].type = 'object';
      val.props[method.key.name].value = method.value;
    });
    val.type = 'object';
    val.value = node;

    return val;
  } case 'ObjectExpression': {
    const val = createNode();
    val.type = 'object';
    node.properties.forEach((prop) => {
      const propVal = getSymbol(prop.value, globals, scope, opts);
      if (propVal) {
        val.props[prop.key.name] = propVal;
      }
    });

    return val;
  } case 'Literal': {
    const val = createNode();
    val.type = 'literal';
    val.value = node;

    return val;
  }
  }

  return null;
};

createSymbol = function (node, globals, value, scope) {
  const block = scope || globals;
  let symbol;
  switch (node.type) {
  case 'ClassDeclaration': {
    if (node.id.type === 'Identifier') {
      return createSymbol(node.id, globals, node, globals);
    }
    break;
  } case 'Identifier': {
    if (value) {
      const valueSymbol = getSymbol(value, globals, block);
      if (valueSymbol) {
        block.props[node.name] = valueSymbol;

        return block.props[node.name];
      }
      debug('Identifier: Missing value symbol for %s', node.name);
    } else {
      block.props[node.name] = createNode();

      return block.props[node.name];
    }
    break;
  } case 'MemberExpression': {
    symbol = getSymbol(node.object, globals, block);

    const propertySymbol = getSymbol(node.property, globals, block, {simpleIdentifier: !node.computed});
    const propertyValue = getSymbolValue(propertySymbol);
    if (symbol && propertyValue) {
      symbol.props[propertyValue] = getSymbol(value, globals, block);

      return symbol.props[propertyValue];
    }
    debug('MemberExpression: Missing symbol: %s', node.property.name);
    break;
  } case 'FunctionDeclaration': {
    if (node.id.type === 'Identifier') {
      return createSymbol(node.id, globals, node, globals);
    }
    break;
  }
  }

  return null;
};

// Creates variables from variable definitions
const initVariables = function (node, globals) {
  switch (node.type) {
  case 'Program': {
    node.body.forEach((childNode) => {
      initVariables(childNode, globals);
    });
    break;
  } case 'ExpressionStatement': {
    initVariables(node.expression, globals);
    break;
  } case 'VariableDeclaration': {
    node.declarations.forEach((declaration) => {
      // let and const
      const symbol = createSymbol(declaration.id, globals, null, globals);
      if (node.kind === 'var' && globals.props.window) {
        // If var, also add to window
        globals.props.window.props[declaration.id.name] = symbol;
      }
    });
    break;
  }
  }
};

// Populates variable maps using AST
const mapVariables = function (node, globals) {
  switch (node.type) {
  case 'Program': {
    node.body.forEach((childNode) => {
      mapVariables(childNode, globals);
    });
    break;
  } case 'ExpressionStatement': {
    mapVariables(node.expression, globals);
    break;
  } case 'AssignmentExpression': {
    createSymbol(node.left, globals, node.right);
    break;
  } case 'VariableDeclaration': {
    node.declarations.forEach((declaration) => {
      createSymbol(declaration.id, globals, declaration.init);
    });
    break;
  } case 'FunctionDeclaration': {
    if (node.id.type === 'Identifier') {
      createSymbol(node.id, globals, node, globals);
    }
    break;
  } case 'ExportDefaultDeclaration': {
    const symbol = createSymbol(node.declaration, globals, node.declaration);
    if (symbol) {
      symbol.exported = true;
    }
    break;
  } case 'ExportNamedDeclaration': {
    if (node.declaration) {
      const symbol = createSymbol(node.declaration, globals, node.declaration);
      symbol.exported = true;
    }
    node.specifiers.forEach((specifier) => {
      mapVariables(specifier, globals);
    });
    break;
  } case 'ExportSpecifier': {
    const symbol = getSymbol(node.local, globals, globals);
    if (symbol) {
      symbol.exported = true;
    }
    break;
  } case 'ClassDeclaration': {
    createSymbol(node.id, globals, node.body, globals);
    break;
  }
  }
};

const findNode = function (node, block, cache) {
  let blockCache = cache || [];
  if (blockCache.includes(block)) {
    return false;
  }
  blockCache = blockCache.slice();
  blockCache.push(block);

  if (block.type === 'object') {
    if (block.value === node) {
      return true;
    }
  }
  for (const prop in block.props) {
    if (Object.prototype.hasOwnProperty.call(block.props, prop)) {
      const propval = block.props[prop];

      // Only check node if it had resolvable value
      if (propval && findNode(node, propval, blockCache)) {
        return true;
      }
    }
  }

  return false;
};

const findExportedNode = function (block, node, cache) {
  const blockCache = cache || [];
  for (const key in block.props) {
    if (Object.prototype.hasOwnProperty.call(block.props, key)) {
      blockCache.push(block.props[key]);
      if (block.props[key].exported) {
        if (findNode(node, block)) {
          return true;
        }
      }
      if (!blockCache.includes(block.props[key]) && findExportedNode(block.props[key], node, blockCache)) {
        return true;
      }
    }
  }

  return false;
};

const isNodeExported = function (node, globals, opt) {
  if (opt.initModuleExports && globals.props.module && globals.props.module.props.exports) {
    if (findNode(node, globals.props.module.props.exports)) {
      return true;
    }
  }

  if (opt.exports && findExportedNode(globals, node)) {
    return true;
  }

  return false;
};

const parse = function (ast, opt) {
  const opts = opt || {
    exports: true,
    initModuleExports: true,
    initWindow: true
  };
  const globalVars = createNode();
  if (opts.initModuleExports) {
    globalVars.props.module = createNode();
    globalVars.props.module.props.exports = createNode();
    globalVars.props.exports = globalVars.props.module.props.exports;
  }
  if (opts.initWindow) {
    globalVars.props.window = globalVars;
  }
  initVariables(ast, globalVars);
  mapVariables(ast, globalVars);

  return {
    globalVars
  };
};

const isExported = function (node, parseResult, opt) {
  return isNodeExported(node, parseResult.globalVars, opt);
};

export default {
  isExported,
  parse
};
