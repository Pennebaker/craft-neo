import $ from 'jquery'
import '../jquery-extensions'

import Garnish from 'garnish'
import Craft from 'craft'

import NS from '../namespace'

import BlockType from './BlockType'
import Group from './Group'
import Block from './Block'
import Buttons from './Buttons'

import renderTemplate from './templates/input.twig'
import '../twig-extensions'
import './styles/input.scss'

const _defaults = {
	namespace: [],
	blockTypes: [],
	groups: [],
	blocks: [],
	inputId: null,
	maxBlocks: 0
}

export default Garnish.Base.extend({

	_templateNs: [],

	init(settings = {})
	{
		settings = Object.assign({}, _defaults, settings)

		this._templateNs = NS.parse(settings.namespace)
		this._blockTypes = []
		this._groups = []
		this._blocks = []
		this._maxBlocks = settings.maxBlocks

		NS.enter(this._templateNs)

		this.$container = $('#' + settings.inputId).append(renderTemplate({
			blockTypes: settings.blockTypes
		}))

		NS.leave()

		for(let btInfo of settings.blockTypes)
		{
			let blockType = new BlockType(btInfo)

			this._blockTypes.push(blockType)
			this._blockTypes[blockType.getHandle()] = blockType
		}

		for(let gInfo of settings.groups)
		{
			let group = new Group(gInfo)

			this._groups.push(group)
		}

		const $neo = this.$container.find('[data-neo]')
		this.$blocksContainer = $neo.filter('[data-neo="container.blocks"]')
		this.$buttonsContainer = $neo.filter('[data-neo="container.buttons"]')

		this._buttons = new Buttons({
			blockTypes: this.getBlockTypes(),
			groups: this.getGroups(),
			maxBlocks: this.getMaxBlocks()
		})

		this.$buttonsContainer.append(this._buttons.$container)
		this._buttons.on('newBlock', e => this['@newBlock'](e))
		this._buttons.initUi()

		this._blockSort = new Garnish.DragSort(null, {
			container: this.$blocksContainer,
			handle: '[data-neo-b="button.move"]',
			axis: 'y',
			filter: () =>
			{
				// Only return all the selected items if the target item is selected
				if(this._blockSort.$targetItem.hasClass('is-selected'))
				{
					return this._blockSelect.getSelectedItems()
				}
				else
				{
					return this._blockSort.$targetItem
				}
			},
			collapseDraggees: true,
			magnetStrength: 4,
			helperLagBase: 1.5,
			helperOpacity: 0.9,
			onSortChange: () => this._updateBlockOrder()
		})

		this._blockSelect = new Garnish.Select(this.$blocksContainer, null, {
			multi: true,
			vertical: true,
			handle: '[data-neo-b="select"], [data-neo-b="button.toggler"]',
			checkboxMode: true,
			selectedClass: 'is-selected sel'
		});

		for(let bInfo of settings.blocks)
		{
			let blockType = this._blockTypes[bInfo.blockType]

			bInfo.namespace = [...this._templateNs, bInfo.id]
			bInfo.blockType = new BlockType({
				name:      blockType.getName(),
				handle:    blockType.getHandle(),
				maxBlocks: blockType.getMaxBlocks(),
				tabs:      bInfo.tabs
			})
			bInfo.buttons = new Buttons({
				blockTypes: blockType.getChildBlockItems(this.getItems()),
				groups: this.getGroups(),
				maxBlocks: this.getMaxBlocks()
			})

			let block = new Block(bInfo)
			this.addBlock(block)
		}
	},

	addBlock(block, index = -1, level = 0)
	{
		const blockCount = this._blocks.length
		index = (index >= 0 ? Math.max(0, Math.min(index, blockCount)) : blockCount)

		const prevBlock = index > 0 ? this._blocks[index - 1] : false
		const nextBlock = index < blockCount ? this._blocks[index] : false

		if(!prevBlock)
		{
			this.$blocksContainer.prepend(block.$container)
			this._blocks.unshift(block)
		}
		else
		{
			const minLevel = nextBlock ? nextBlock.getLevel() : 0
			const maxLevel = prevBlock.getLevel() + (prevBlock.getBlockType().isParent() ? 1 : 0)

			level = Math.max(minLevel, Math.min(level, maxLevel))

			const prevBlockOnLevel = this._findPrevBlockOnLevel(index, level)

			if(prevBlockOnLevel)
			{
				prevBlockOnLevel.$container.after(block.$container)
			}
			else
			{
				prevBlock.$blocksContainer.append(block.$container)
			}

			this._blocks.splice(index, 0, block)
		}

		block.setLevel(level)

		this._blockSort.addItems(block.$container)
		this._blockSelect.addItems(block.$container)

		block.initUi()
		block.on('destroy.input',         e => this._blockBatch(block, b => this.removeBlock(b)))
		block.on('toggleEnabled.input',   e => this._blockBatch(block, b => b.toggleEnabled(e.enabled)))
		block.on('toggleExpansion.input', e => this._blockBatch(block, b => b.toggleExpansion(e.expanded)))
		block.on('newBlock.input',        e => this['@newBlock'](Object.assign(e, {index: this._blocks.indexOf(block) + 1})))
		block.on('addBlockAbove.input',   e => this['@addBlockAbove'](e))

		this._destroyTempButtons()
		this._updateButtons()
		this._updateBlockOrder()

		this.trigger('addBlock', {
			block: block,
			index: index
		})
	},

	removeBlock(block)
	{
		const childBlocks = this._findChildBlocks(this._blocks.indexOf(block))
		for(let childBlock of childBlocks)
		{
			this.removeBlock(childBlock)
		}

		block.$container.remove()
		block.off('.input')

		this._blocks = this._blocks.filter(b => b !== block)
		this._blockSort.removeItems(block.$container)
		this._blockSelect.removeItems(block.$container)

		this._destroyTempButtons()
		this._updateButtons()

		this.trigger('removeBlock', {
			block: block
		})
	},

	getBlockByElement($block)
	{
		return this._blocks.find(block => block.$container.is($block))
	},

	getBlocks()
	{
		return Array.from(this._blocks)
	},

	getBlockTypes()
	{
		return Array.from(this._blockTypes)
	},

	getGroups()
	{
		return Array.from(this._groups)
	},

	getItems()
	{
		return [...this.getBlockTypes(), ...this.getGroups()].sort((a, b) => a.getSortOrder() - b.getSortOrder())
	},

	getMaxBlocks()
	{
		return this._maxBlocks
	},

	getSelectedBlocks()
	{
		const $selectedBlocks = this._blockSelect.getSelectedItems()
		return this._blocks.filter(block => block.$container.is($selectedBlocks))
	},

	_updateBlockOrder()
	{
		const blocks = []

		this._blockSort.$items.each((index, element) =>
		{
			const block = this.getBlockByElement(element)
			blocks.push(block)
		})

		this._blocks = blocks
	},

	_updateButtons()
	{
		const blocks = this.getBlocks()
		this._buttons.updateButtonStates(blocks)

		if(this._tempButtons)
		{
			this._tempButtons.updateButtonStates(blocks)
		}
	},

	_blockBatch(block, callback)
	{
		const blocks = block.isSelected() ? this.getSelectedBlocks() : [block]

		for(let b of blocks)
		{
			callback(b)
		}
	},

	_destroyTempButtons()
	{
		if(this._tempButtons)
		{
			this._tempButtons.off('newBlock')
			this._tempButtons.$container.remove()
			this._tempButtons = null
		}
	},

	_findPrevBlockOnLevel(index, level)
	{
		const blocks = this._blocks

		let block = blocks[--index]
		let lowestLevel = Number.MAX_VALUE

		while(block)
		{
			let blockLevel = block.getLevel()

			if(blockLevel < lowestLevel)
			{
				if(blockLevel === level)
				{
					return block
				}

				lowestLevel = blockLevel
			}

			block = this._blocks[--index]
		}

		return false
	},

	_findChildBlocks(index)
	{
		const blocks = this._blocks
		const block = blocks[index]
		const childBlocks = []

		if(block)
		{
			const level = block.getLevel()

			let currentBlock = blocks[++index]
			while(currentBlock && currentBlock.getLevel() > level)
			{
				if(currentBlock.getLevel() === level + 1)
				{
					childBlocks.push(currentBlock)
				}

				currentBlock = blocks[++index]
			}
		}

		return childBlocks
	},

	'@newBlock'(e)
	{
		const blockId = Block.getNewId()
		const block = new Block({
			namespace: [...this._templateNs, blockId],
			blockType: e.blockType,
			id: blockId,
			buttons: new Buttons({
				blockTypes: e.blockType.getChildBlockItems(this.getItems()),
				groups: this.getGroups(),
				maxBlocks: this.getMaxBlocks()
			})
		})

		this.addBlock(block, e.index, e.level)
	},

	'@addBlockAbove'(e)
	{
		this._destroyTempButtons()

		const block = e.block
		const buttons = new Buttons({
			blockTypes: this.getBlockTypes(),
			groups: this.getGroups(),
			maxBlocks: this.getMaxBlocks(),
			blocks: this.getBlocks()
		})

		block.$container.before(buttons.$container)
		buttons.on('newBlock', e =>
		{
			this['@newBlock']({
				blockType: e.blockType,
				index: this._blocks.indexOf(block),
				level: block.getLevel()
			})
		})

		buttons.initUi()

		this._tempButtons = buttons
	}
})
