'use strict';

const path = require('path');

const syntax = require('@babel/plugin-syntax-dynamic-import');
const whatwgUrl = require('whatwg-url');
const resolve = require('resolve');
const pathIsInside = require('path-is-inside');
const isWindows = require('is-windows');
const minimatch = require('minimatch');

const isPathSpecifier = str => /^\.{0,2}\//.test(str);

function basedirResolve(importPath, sourceFileName, pluginOptions) {
	const {alwaysRootImport, neverRootImport} = {
		alwaysRootImport: [],
		neverRootImport: [],
		...pluginOptions,
	};
	const sourceDirName = path.dirname(sourceFileName);

	if (isPathSpecifier(importPath)) {
		/* Not a bare import. */
		return sourceDirName;
	}

	if (!Array.isArray(alwaysRootImport) || alwaysRootImport.length === 0) {
		return sourceDirName;
	}

	const importPackage = importPath.split('/', importPath[0] === '@' ? 2 : 1).join('/');

	if (alwaysRootImport.some(v => minimatch(importPackage, v)) &&
			!neverRootImport.some(v => minimatch(importPackage, v))) {
		return pluginOptions.rootBaseDir || process.cwd();
	}

	return sourceDirName;
}

function absResolve(importPath, sourceFileName, pluginOptions = {}) {
	if (whatwgUrl.parseURL(importPath) !== null) {
		return importPath;
	}

	return resolve.sync(importPath, {
		basedir: basedirResolve(importPath, sourceFileName, pluginOptions),
		extensions: pluginOptions.extensions || ['.mjs', '.js', 'json'],
		packageFilter(packageJson) {
			packageJson.main = packageJson.module ||
				packageJson['jsnext:main'] || packageJson.main;
			return packageJson;
		},
	});
}

function tryResolve(importPath, sourceFileName, pluginOptions) {
	if (whatwgUrl.parseURL(importPath) !== null) {
		return importPath;
	}

	try {
		const importPathAbs = absResolve(importPath, sourceFileName, pluginOptions);
		const nodeModules = path.resolve(pluginOptions.rootBaseDir || process.cwd(), 'node_modules');
		const isNodeModule = pathIsInside(importPathAbs, nodeModules);
		const fromNodeModule = pathIsInside(path.resolve(sourceFileName), nodeModules);
		let importPathRel = path.relative(path.dirname(sourceFileName), importPathAbs);

		if (isNodeModule && !fromNodeModule) {
			const modulesDir = pluginOptions.modulesDir || '/node_modules';
			if (modulesDir.includes('://')) {
				return modulesDir + (modulesDir.endsWith('/') ? '' : '/') + path.relative(nodeModules, importPathAbs);
			}

			importPathRel = path.join(
				pluginOptions.modulesDir || '/node_modules',
				path.relative(nodeModules, importPathAbs));
		}
		/* istanbul ignore if */
		if (isWindows()) {
			/* Normalize path separators to URL format */
			importPathRel = importPathRel.replace(/\\/g, '/');
		}
		if (!isPathSpecifier(importPathRel)) {
			importPathRel = './' + importPathRel;
		}

		return importPathRel;
	} catch (error) {
		console.error(`Could not resolve '${importPath}' in file '${sourceFileName}'.`);
		return importPath;
	}
}

module.exports = () => ({
	inherits: syntax.default,
	visitor: {
		CallExpression(path, {opts}) {
			if (path.node.callee.type !== 'Import') {
				return;
			}

			const [source] = path.node.arguments;
			if (source.type !== 'StringLiteral') {
				/* Should never happen */
				return;
			}

			source.value = tryResolve(source.value, path.hub.file.opts.parserOpts.sourceFileName, opts);
		},
		'ImportDeclaration|ExportNamedDeclaration|ExportAllDeclaration'(path, {opts}) {
			const {source} = path.node;

			// An export without a 'from' clause
			if (source === null) {
				return;
			}

			source.value = tryResolve(source.value, path.hub.file.opts.parserOpts.sourceFileName, opts);
		},
	},
});
module.exports.resolve = absResolve;
