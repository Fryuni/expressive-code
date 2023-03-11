import { describe, expect, test } from 'vitest'
import { sanitize } from 'hast-util-sanitize'
import { ExpressiveCode, ExpressiveCodeProcessingState } from '../src/common/engine'
import { ExpressiveCodeHook, ExpressiveCodePlugin, ExpressiveCodePluginHookName, ExpressiveCodePluginHooks } from '../src/common/plugin'
import { expectToWorkOrThrow, getWrapperRenderer, nonArrayValues, nonObjectValues, testRender } from './utils'
import { toHtml } from 'hast-util-to-html'
import { h } from 'hastscript'
import { ExpressiveCodeBlock } from '../src/common/block'

describe('ExpressiveCode', () => {
	describe('process()', () => {
		describe('Validates input', () => {
			test('Throws on invalid input', () => {
				const invalidValues: unknown[] = [
					// Non-array values (including one empty object)
					...nonArrayValues,
					// Arrays containing non-object values
					...nonObjectValues.map((value) => [value]),
					// Data objects with missing properties
					{ code: 'test' },
					{ language: 'test' },
					{ meta: 'test' },
				]
				invalidValues.forEach((invalidValue) => {
					expect(() => {
						const ec = new ExpressiveCode({ plugins: [] })
						// @ts-expect-error Intentionally passing an invalid value
						ec.process(invalidValue)
					}).toThrow()
				})
			})
			test('Accepts a single ExpressiveCodeBlock instance', () => {
				const ec = new ExpressiveCode({ plugins: [] })
				const codeBlock = new ExpressiveCodeBlock({ code: 'test', language: 'md', meta: '' })
				const result = ec.process(codeBlock)
				expect(result.groupContents).toHaveLength(1)
				expect(result.groupContents[0].codeBlock, 'Expected the same block instance to be returned in group contents').toBe(codeBlock)
			})
			test('Accepts a single data object and creates an ExpressiveCodeBlock instance from it', () => {
				const ec = new ExpressiveCode({ plugins: [] })
				const result = ec.process({ code: 'test', language: 'md', meta: '' })
				expect(result.groupContents).toHaveLength(1)
				const codeBlock = result.groupContents[0].codeBlock
				expect(codeBlock).toBeInstanceOf(ExpressiveCodeBlock)
				expect(codeBlock.code).toEqual('test')
			})
			test('Accepts multiple ExpressiveCodeBlock instances', () => {
				const ec = new ExpressiveCode({ plugins: [] })
				const codeBlocks = ['test1', 'test2', 'test3'].map((code) => new ExpressiveCodeBlock({ code, language: 'md', meta: '' }))
				const result = ec.process(codeBlocks)
				expect(result.groupContents).toHaveLength(codeBlocks.length)
				codeBlocks.forEach((codeBlock, i) => {
					expect(result.groupContents[i].codeBlock, 'Expected the same block instances to be returned in group contents').toBe(codeBlock)
				})
			})
			test('Accepts multiple data objects and creates ExpressiveCodeBlock instances from them', () => {
				const ec = new ExpressiveCode({ plugins: [] })
				const dataObjects = ['test1', 'test2', 'test3'].map((code) => ({ code, language: 'md', meta: '' }))
				const result = ec.process(dataObjects)
				expect(result.groupContents).toHaveLength(dataObjects.length)
				dataObjects.forEach((dataObject, i) => {
					expect(result.groupContents[i].codeBlock.code, 'Expected the created block instance to contain the input code').toEqual(dataObject.code)
				})
			})
		})
		describe('Calls block-level hooks with the correct processing state', () => {
			const baseState: ExpressiveCodeProcessingState = {
				canEditMetadata: true,
				canEditCode: true,
				canEditAnnotations: true,
			}
			const readonlyState: ExpressiveCodeProcessingState = {
				canEditMetadata: false,
				canEditCode: false,
				canEditAnnotations: false,
			}
			const testCases: [ExpressiveCodePluginHookName, number, ExpressiveCodeProcessingState][] = [
				['preprocessMetadata', 1, { ...baseState, canEditCode: false }],
				['preprocessCode', 1, baseState],
				['performSyntaxAnalysis', 1, baseState],
				['postprocessAnalyzedCode', 1, baseState],
				['annotateCode', 1, { ...baseState, canEditCode: false }],
				['postprocessAnnotations', 1, { ...baseState, canEditCode: false }],
				['postprocessRenderedLine', 2, { ...readonlyState }],
				['postprocessRenderedBlock', 1, { ...readonlyState }],
			]
			test.each(testCases)('%s', (hookName, expectedCallCount, state) => {
				// Ensure that the code block's state property contains the expected data
				let actualCallCount = 0
				getHookTestResult(hookName, ({ codeBlock }) => {
					expect(codeBlock.state).toEqual(state)
					actualCallCount++
				})

				// Expect the hook to have been called the expected number of times
				expect(actualCallCount).toEqual(expectedCallCount)

				// Perform edits of all properties to ensure they work or throw as expected
				expectToWorkOrThrow(state.canEditMetadata, () => testEditingProperty(hookName, 'meta'))
				expectToWorkOrThrow(state.canEditMetadata, () => testEditingProperty(hookName, 'language'))
				expectToWorkOrThrow(state.canEditAnnotations, () => testAddingAnnotation(hookName))
				expectToWorkOrThrow(state.canEditCode, () => testEditingCode(hookName))
			})
		})
		describe('Allows post-processing ASTs after rendering', () => {
			describe('postprocessRenderedLine', () => {
				test('Can edit line AST', () => {
					let totalHookCalls = 0
					const { blockAst } = getMultiHookTestResult({
						hooks: {
							postprocessRenderedLine: ({ renderData }) => {
								totalHookCalls++
								if (!renderData.lineAst.properties) renderData.lineAst.properties = {}
								renderData.lineAst.properties.test = totalHookCalls
							},
						},
					})
					expect(totalHookCalls).toEqual(2)
					const html = toHtml(sanitize(blockAst, { attributes: { '*': ['test'] } }))
					expect(html).toEqual('<pre><code><div test="1">Example code...</div><div test="2">...with two lines!</div></code></pre>')
				})
				test('Can completely replace line AST', () => {
					let totalHookCalls = 0
					const { blockAst } = getMultiHookTestResult({
						hooks: {
							postprocessRenderedLine: ({ renderData }) => {
								totalHookCalls++
								renderData.lineAst = h('div', { test: totalHookCalls }, 'Replaced line')
							},
						},
					})
					expect(totalHookCalls).toEqual(2)
					const html = toHtml(sanitize(blockAst, { attributes: { '*': ['test'] } }))
					expect(html).toEqual('<pre><code><div test="1">Replaced line</div><div test="2">Replaced line</div></code></pre>')
				})
				test('Subsequent hooks see line edits/replacements', () => {
					let totalHookCalls = 0
					const { blockAst } = getMultiPluginTestResult({
						plugins: [
							{
								name: 'EditLinePlugin',
								hooks: {
									postprocessRenderedLine: ({ renderData }) => {
										totalHookCalls++
										if (!renderData.lineAst.properties) renderData.lineAst.properties = {}
										renderData.lineAst.properties.test = totalHookCalls
									},
								},
							},
							{
								name: 'WrapLinePlugin',
								hooks: {
									postprocessRenderedLine: ({ renderData }) => {
										totalHookCalls++
										renderData.lineAst = h('a', { href: `#${totalHookCalls}` }, renderData.lineAst)
									},
								},
							},
							{
								name: 'EditWrappedLinePlugin',
								hooks: {
									postprocessRenderedLine: ({ renderData }) => {
										totalHookCalls++
										if (!renderData.lineAst.properties) renderData.lineAst.properties = {}
										renderData.lineAst.properties.edited = totalHookCalls
									},
								},
							},
						],
					})
					expect(totalHookCalls).toEqual(6)
					const html = toHtml(sanitize(blockAst, { attributes: { '*': ['test', 'edited'], a: ['href'] } }))
					expect(html).toEqual(
						[
							`<pre><code>`,
							`<a href="#2" edited="3"><div test="1">Example code...</div></a>`,
							`<a href="#5" edited="6"><div test="4">...with two lines!</div></a>`,
							`</code></pre>`,
						].join('')
					)
				})
			})
			describe('postprocessRenderedBlock', () => {
				test('Can edit block AST', () => {
					let totalHookCalls = 0
					const { blockAst } = getMultiHookTestResult({
						hooks: {
							postprocessRenderedBlock: ({ renderData }) => {
								totalHookCalls++
								if (!renderData.blockAst.properties) renderData.blockAst.properties = {}
								renderData.blockAst.properties.test = totalHookCalls
							},
						},
					})
					expect(totalHookCalls).toEqual(1)
					const html = toHtml(sanitize(blockAst, { attributes: { '*': ['test'] } }))
					expect(html).toEqual('<pre test="1"><code><div>Example code...</div><div>...with two lines!</div></code></pre>')
				})
				test('Can completely replace block AST', () => {
					let totalHookCalls = 0
					const { blockAst } = getMultiHookTestResult({
						hooks: {
							postprocessRenderedBlock: ({ renderData }) => {
								totalHookCalls++
								// Replace block with a version wrapped in a div
								renderData.blockAst = h('div', { test: totalHookCalls }, 'I am completely different now!')
							},
						},
					})
					expect(totalHookCalls).toEqual(1)
					const html = toHtml(sanitize(blockAst, { attributes: { '*': ['test'] } }))
					expect(html).toEqual('<div test="1">I am completely different now!</div>')
				})
				test('Subsequent hooks see block edits/replacements', () => {
					let totalHookCalls = 0
					const { blockAst } = getMultiPluginTestResult({
						plugins: [
							{
								name: 'EditBlockPlugin',
								hooks: {
									postprocessRenderedBlock: ({ renderData }) => {
										totalHookCalls++
										if (!renderData.blockAst.properties) renderData.blockAst.properties = {}
										renderData.blockAst.properties.test = totalHookCalls
									},
								},
							},
							{
								name: 'WrapBlockPlugin',
								hooks: {
									postprocessRenderedBlock: ({ renderData }) => {
										totalHookCalls++
										renderData.blockAst = h('div', { test: totalHookCalls }, renderData.blockAst)
									},
								},
							},
							{
								name: 'EditWrappedBlockPlugin',
								hooks: {
									postprocessRenderedBlock: ({ renderData }) => {
										totalHookCalls++
										if (!renderData.blockAst.properties) renderData.blockAst.properties = {}
										renderData.blockAst.properties.edited = totalHookCalls
									},
								},
							},
						],
					})
					expect(totalHookCalls).toEqual(3)
					const html = toHtml(sanitize(blockAst, { attributes: { '*': ['test', 'edited'], a: ['href'] } }))
					expect(html).toEqual('<div test="2" edited="3"><pre test="1"><code><div>Example code...</div><div>...with two lines!</div></code></pre></div>')
				})
			})
		})
		describe('Provides getPluginData() hook context function to plugins', () => {
			describe('Block-scoped plugin data', () => {
				test('Is shared between hooks while processing the same block', () => {
					getMultiHookTestResult({
						hooks: {
							preprocessMetadata: ({ getPluginData }) => {
								const blockData = getPluginData('block', { justInitialized: true })
								blockData.justInitialized = false
							},
							annotateCode: ({ getPluginData }) => {
								const blockData = getPluginData('block', { justInitialized: true })
								expect(blockData.justInitialized).toEqual(false)
							},
						},
					})
				})
				test('Is not shared between different blocks (= block scope)', () => {
					const testPlugin: ExpressiveCodePlugin = {
						name: 'TestPlugin',
						hooks: {
							preprocessMetadata: ({ getPluginData }) => {
								const blockData = getPluginData('block', { counter: 0 })
								// No matter how many blocks were already processed before,
								// blockData should always have restarted from 0 here
								expect(blockData.counter).toEqual(0)
								blockData.counter++
							},
							annotateCode: ({ getPluginData }) => {
								const blockData = getPluginData('block', { counter: 0 })
								expect(blockData.counter).toEqual(1)
							},
						},
					}
					const ec = new ExpressiveCode({
						plugins: [testPlugin],
					})
					const input = {
						code: 'Example code',
						language: 'md',
						meta: 'test',
					}

					// Reuse the same plugin instance for processing three subsequent blocks
					ec.process(input)
					ec.process(input)
					ec.process(input)
				})
				test('Is not shared between plugins', () => {
					const pluginOne: ExpressiveCodePlugin = {
						name: 'PluginOne',
						hooks: {
							preprocessMetadata: ({ getPluginData }) => {
								const blockData = getPluginData('block', { justInitialized: true })
								blockData.justInitialized = false
							},
						},
					}
					const pluginTwo: ExpressiveCodePlugin = {
						name: 'PluginTwo',
						hooks: {
							annotateCode: ({ getPluginData }) => {
								const blockData = getPluginData('block', { justInitialized: true })
								expect(blockData.justInitialized).toEqual(true)
							},
						},
					}
					getMultiPluginTestResult({
						plugins: [pluginOne, pluginTwo],
					})
				})
			})
			describe('Global plugin data', () => {
				test('Is shared between hooks while processing the same block', () => {
					getMultiHookTestResult({
						hooks: {
							preprocessMetadata: ({ getPluginData }) => {
								const blockData = getPluginData('global', { justInitialized: true })
								blockData.justInitialized = false
							},
							annotateCode: ({ getPluginData }) => {
								const blockData = getPluginData('global', { justInitialized: true })
								expect(blockData.justInitialized).toEqual(false)
							},
						},
					})
				})
				test('Is shared between different blocks (= global scope)', () => {
					let expectedProcessedBlocks = 0
					const testPlugin: ExpressiveCodePlugin = {
						name: 'TestPlugin',
						hooks: {
							preprocessMetadata: ({ getPluginData }) => {
								const globalData = getPluginData('global', { processedBlocks: 0 })
								expect(globalData.processedBlocks).toEqual(expectedProcessedBlocks)
								globalData.processedBlocks++
							},
						},
					}
					const ec = new ExpressiveCode({
						plugins: [testPlugin],
					})
					const input = {
						code: 'Example code',
						language: 'md',
						meta: 'test',
					}

					// Reuse the same plugin instance for processing three subsequent blocks
					ec.process(input)
					expectedProcessedBlocks++
					ec.process(input)
					expectedProcessedBlocks++
					ec.process(input)
				})
				test('Is not shared between plugins', () => {
					const pluginOne: ExpressiveCodePlugin = {
						name: 'PluginOne',
						hooks: {
							preprocessMetadata: ({ getPluginData }) => {
								const blockData = getPluginData('global', { justInitialized: true })
								blockData.justInitialized = false
							},
						},
					}
					const pluginTwo: ExpressiveCodePlugin = {
						name: 'PluginTwo',
						hooks: {
							annotateCode: ({ getPluginData }) => {
								const blockData = getPluginData('global', { justInitialized: true })
								expect(blockData.justInitialized).toEqual(true)
							},
						},
					}
					getMultiPluginTestResult({
						plugins: [pluginOne, pluginTwo],
					})
				})
			})
		})
		describe('Returns the rendered code block AST', () => {
			test('Plain code block', () => {
				const { blockAst } = getMultiPluginTestResult({ plugins: [] })
				const html = toHtml(sanitize(blockAst, {}))
				expect(html).toEqual('<pre><code><div>Example code...</div><div>...with two lines!</div></code></pre>')
			})
			test('Code block with inline annotation', () => {
				const searchTerm = 'two '
				const { blockAst } = getHookTestResult('annotateCode', ({ codeBlock }) => {
					const line = codeBlock.getLine(1)
					if (!line) return
					const index = line.text.indexOf(searchTerm)
					line.addAnnotation({
						name: 'del',
						render: getWrapperRenderer('del'),
						inlineRange: {
							columnStart: index,
							columnEnd: index + searchTerm.length,
						},
					})
				})
				const html = toHtml(sanitize(blockAst, {}))
				expect(html).toEqual('<pre><code><div>Example code...</div><div>...with <del>two </del>lines!</div></code></pre>')
			})
		})
	})
})

function testEditingProperty(hookName: ExpressiveCodePluginHookName, propertyName: 'meta' | 'language') {
	const { codeBlock, input } = getHookTestResult(hookName, ({ codeBlock }) => {
		codeBlock[propertyName] = `wrapped(${codeBlock[propertyName]})`
	})
	expect(codeBlock[propertyName]).toEqual(`wrapped(${input[propertyName]})`)
}

function testAddingAnnotation(hookName: ExpressiveCodePluginHookName) {
	const testAnnotation = {
		name: 'del',
		render: testRender,
	}
	const { codeBlock } = getHookTestResult(hookName, ({ codeBlock }) => {
		codeBlock.getLine(0)?.addAnnotation(testAnnotation)
	})
	expect(codeBlock.getLine(0)?.getAnnotations()).toMatchObject([testAnnotation])
}

function testEditingCode(hookName: ExpressiveCodePluginHookName) {
	const { codeBlock, input } = getHookTestResult(hookName, ({ codeBlock }) => {
		codeBlock.insertLine(0, 'Prepended line')
	})
	expect(codeBlock.code).toEqual('Prepended line\n' + input.code)
}

function getHookTestResult(hookName: ExpressiveCodePluginHookName, hookFunc: ExpressiveCodeHook) {
	return getMultiHookTestResult({
		hooks: {
			[hookName]: hookFunc,
		},
	})
}

function getMultiHookTestResult({ hooks }: { hooks: ExpressiveCodePluginHooks }) {
	return getMultiPluginTestResult({
		plugins: [
			{
				name: 'TestPlugin',
				hooks,
			},
		],
	})
}

function getMultiPluginTestResult({ plugins }: { plugins: ExpressiveCodePlugin[] }) {
	const ec = new ExpressiveCode({
		plugins,
	})
	const input = {
		code: ['Example code...', '...with two lines!'].join('\n'),
		language: 'md',
		meta: 'test',
	}

	const result = ec.process(input)
	expect(result.groupContents).toHaveLength(1)

	return {
		...result.groupContents[0],
		input,
	}
}
