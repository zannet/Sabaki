const {remote} = require('electron')
const {h, Component} = require('preact')
const classNames = require('classnames')

const gametree = require('../modules/gametree')
const helper = require('../modules/helper')
const setting = remote.require('./modules/setting')

let [delay, animationDuration, commentProperties,
edgeColor, edgeInactiveColor, edgeSize, edgeInactiveSize,
nodeColor, nodeInactiveColor, nodeActiveColor,
nodeBookmarkColor, nodeCommentColor] = ['graph.delay', 'graph.animation_duration', 'sgf.comment_properties',
    'graph.edge_color', 'graph.edge_inactive_color', 'graph.edge_size', 'graph.edge_inactive_size',
    'graph.node_color', 'graph.node_inactive_color', 'graph.node_active_color',
    'graph.node_bookmark_color', 'graph.node_comment_color'].map(x => setting.get(x))

class GameGraphNode extends Component {
    constructor() {
        super()

        this.state = {
            hover: false
        }

        this.handleMouseMove = evt => {
            if (!this.element) return

            let {clientX: x, clientY: y} = evt
            let {position, mouseShift: [sx, sy], gridSize} = this.props
            let mousePosition = [x + sx, y + sy]
            let hover = false

            if (mousePosition.every((x, i) => Math.ceil(position[i] - gridSize / 2) <= x
            && x <= Math.floor(position[i] + gridSize / 2) - 1)) {
                hover = true
            }

            if (hover !== this.state.hover) {
                this.setState({hover})
            }
        }
    }

    componentDidMount() {
        document.addEventListener('mousemove', this.handleMouseMove)
    }

    componentWillUnmount() {
        document.removeEventListener('mousemove', this.handleMouseMove)
    }

    shouldComponentUpdate({type, fill, nodeSize, gridSize}, {hover}) {
        return type !== this.props.type
            || fill !== this.props.fill
            || nodeSize !== this.props.nodeSize
            || gridSize !== this.props.gridSize
            || hover !== this.state.hover
    }

    render({
        position: [left, top],
        type,
        fill,
        nodeSize
    }, {
        hover
    }) {
        return h('path', {
            ref: el => this.element = el,
            d: (() => {
                let nodeSize2 = nodeSize * 2

                if (type === 'square') {
                    return `M ${left - nodeSize} ${top - nodeSize}
                        h ${nodeSize2} v ${nodeSize2} h ${-nodeSize2} v ${-nodeSize2}`
                } else if (type === 'circle') {
                    return `M ${left} ${top} m ${-nodeSize} 0
                        a ${nodeSize} ${nodeSize} 0 1 0 ${nodeSize2} 0
                        a ${nodeSize} ${nodeSize} 0 1 0 ${-nodeSize2} 0`
                } else if (type === 'diamond') {
                    let diamondSide = Math.round(Math.sqrt(2) * nodeSize)

                    return `M ${left} ${top - diamondSide}
                        L ${left - diamondSide} ${top} L ${left} ${top + diamondSide}
                        L ${left + diamondSide} ${top} L ${left} ${top - diamondSide}`
                }

                return ''
            })(),

            class: classNames({hover}),
            fill
        })
    }
}

class GameGraphEdge extends Component {
    shouldComponentUpdate({positionAbove, positionBelow, current, length, gridSize}) {
        return length !== this.props.length
            || current !== this.props.current
            || gridSize !== this.props.gridSize
            || !helper.vertexEquals(positionAbove, this.props.positionAbove)
            || !helper.vertexEquals(positionBelow, this.props.positionBelow)
    }

    render({
        positionAbove: [left1, top1],
        positionBelow: [left2, top2],
        length,
        gridSize,
        current
    }) {
        let points

        if (left1 === left2) {
            points = `${left1},${top1} ${left1},${top2 + length}`
        } else {
            points = `${left1},${top1} ${left2 - gridSize},${top2 - gridSize}
                ${left2},${top2} ${left2},${top2 + length}`
        }

        return h('polyline', {
            points,
            fill: 'none',
            stroke: current ? edgeColor : edgeInactiveColor,
            'stroke-width': current ? edgeSize : edgeInactiveSize
        })
    }
}

class GameGraph extends Component {
    constructor(props) {
        super(props)

        this.state = {
            cameraPosition: [-props.gridSize, -props.gridSize],
            viewportSize: [props.viewportWidth, props.height],
            viewportPosition: [0, 0],
            matrixDict: null
        }

        this.mousePosition = [-100, -100]
        this.matrixDictHash = null
        this.matrixDictCache = {}

        this.handleNodeClick = this.handleNodeClick.bind(this)
        this.handleGraphMouseDown = this.handleGraphMouseDown.bind(this)
    }

    componentDidMount() {
        document.addEventListener('mousemove', evt => {
            if (!this.svgElement) return

            let {clientX: x, clientY: y, movementX, movementY} = evt
            let {cameraPosition: [cx, cy], viewportPosition: [vx, vy]} = this.state

            if (this.mouseDown == null) {
                ;[movementX, movementY] = [0, 0]
                this.drag = false
            } else if (this.mouseDown === 0) {
                this.drag = true
            } else {
                ;[movementX, movementY] = [0, 0]
                this.drag = false
            }

            this.mousePosition = [x - vx, y - vy]

            if (this.drag) {
                this.setState({cameraPosition: [cx - movementX, cy - movementY]})
            }
        })

        document.addEventListener('mouseup', () => {
            this.mouseDown = null
        })

        window.addEventListener('resize', () => {
            clearTimeout(this.remeasureId)
            this.remeasureId = setTimeout(() => this.remeasure(), 500)
        })

        this.remeasure()
        this.componentWillReceiveProps()
    }

    shouldComponentUpdate({showGameGraph, height}) {
        return height !== this.props.height || showGameGraph && !this.dirty
    }

    componentWillReceiveProps({treePosition} = {}) {
        // Debounce rendering

        if (treePosition === this.props.treePosition) return

        this.dirty = true

        clearTimeout(this.renderId)
        this.renderId = setTimeout(() => this.updateCameraPosition(), delay)
    }

    componentDidUpdate({height, showGameGraph}) {
        if (height !== this.props.height) {
            setTimeout(() => this.remeasure(), 200)
        }

        if (showGameGraph !== this.props.showGameGraph) {
            setTimeout(() => this.updateCameraPosition(), 200)
        }
    }

    getMatrixDict(tree) {
        let hash = gametree.getMatrixHash(tree)

        if (hash !== this.matrixDictHash) {
            this.matrixDictHash = hash
            this.matrixDictCache = gametree.getMatrixDict(tree)
        }

        return this.matrixDictCache
    }

    updateCameraPosition() {
        let {gridSize, treePosition: [tree, index]} = this.props
        let id = tree.id + '-' + index

        let [matrix, dict] = this.getMatrixDict(gametree.getRoot(tree))
        let [x, y] = dict[id]
        let [width, padding] = gametree.getMatrixWidth(y, matrix)

        let relX = width === 1 ? 0 : 1 - 2 * (x - padding) / (width - 1)
        let diff = (width - 1) * gridSize / 2
        diff = Math.min(diff, this.state.viewportSize[0] / 2 - gridSize)

        this.dirty = false

        this.setState({
            matrixDict: [matrix, dict],
            cameraPosition: [
                x * gridSize + relX * diff - this.state.viewportSize[0] / 2,
                y * gridSize - this.state.viewportSize[1] / 2
            ].map(z => Math.round(z))
        })
    }

    remeasure() {
        if (!this.props.showGameGraph) return

        let {left, top, width, height} = this.element.getBoundingClientRect()
        this.setState({viewportSize: [width, height], viewportPosition: [left, top]})
    }

    handleGraphMouseDown(evt) {
        this.mouseDown = evt.button
    }

    handleNodeClick(evt) {
        if (this.drag) {
            this.drag = false
            return
        }

        let {onNodeClick = helper.noop, gridSize} = this.props
        let {matrixDict: [matrix, ], cameraPosition: [cx, cy]} = this.state
        let [mx, my] = this.mousePosition
        let [nearestX, nearestY] = [mx + cx, my + cy].map(z => Math.round(z / gridSize))

        if (!matrix[nearestY] || !matrix[nearestY][nearestX]) return

        evt.treePosition = matrix[nearestY][nearestX]
        onNodeClick(evt)
    }

    renderNodes({
        gridSize,
        nodeSize
    }, {
        matrixDict: [matrix, dict],
        cameraPosition: [cx, cy],
        viewportSize: [width, height],
        viewportPosition: [vx, vy]
    }) {
        let nodeColumns = []
        let edges = []

        let [minX, minY] = [cx, cy].map(z => Math.max(Math.ceil(z / gridSize) - 2, 0))
        let [maxX, maxY] = [cx, cy].map((z, i) => (z + [width, height][i]) / gridSize + 2)
        minY -= 3
        maxY += 3

        let doneTreeBones = []
        let currentTracks = []
        let notCurrentTracks = []

        // Render only nodes that are visible

        for (let x = minX; x <= maxX; x++) {
            let column = []

            for (let y = minY; y <= maxY; y++) {
                if (matrix[y] == null || matrix[y][x] == null) continue

                let [tree, index] = matrix[y][x]
                let node = tree.nodes[index]
                let onCurrentTrack

                if (currentTracks.includes(tree.id)) {
                    onCurrentTrack = true
                } else if (notCurrentTracks.includes(tree.id)) {
                    onCurrentTrack = false
                } else {
                    if (!tree.parent) {
                        onCurrentTrack = true
                        currentTracks.push(tree.id)
                    } else if (currentTracks.includes(tree.parent.id)) {
                        if (tree.parent.subtrees[tree.parent.current] !== tree) {
                            onCurrentTrack = false
                            notCurrentTracks.push(tree.id)
                        } else {
                            onCurrentTrack = true
                            currentTracks.push(tree.id)
                        }
                    } else if (notCurrentTracks.includes(tree.parent.id)) {
                        onCurrentTrack = false
                        notCurrentTracks.push(tree.id)
                    } else {
                        onCurrentTrack = gametree.onCurrentTrack(tree)

                        if (onCurrentTrack) currentTracks.push(tree.id)
                        else notCurrentTracks.push(tree.id)
                    }
                }

                // Render node

                let fill = !onCurrentTrack ? nodeInactiveColor
                    : helper.vertexEquals(this.props.treePosition, [tree, index]) ? nodeActiveColor
                    : 'HO' in node ? nodeBookmarkColor
                    : commentProperties.some(x => x in node) ? nodeCommentColor
                    : nodeColor

                let left = x * gridSize
                let top = y * gridSize

                column.push(h(GameGraphNode, {
                    key: y,
                    mouseShift: [cx - vx, cy - vy],
                    position: [left, top],
                    type: 'B' in node && node.B[0] === '' || 'W' in node && node.W[0] === ''
                        ? 'square' // Pass node
                        : !('B' in node || 'W' in node)
                        ? 'diamond' // Non-move node
                        : 'circle', // Normal node
                    fill,
                    nodeSize,
                    gridSize
                }))

                if (!doneTreeBones.includes(tree.id)) {
                    // A *tree bone* denotes a straight edge through the whole tree

                    let positionAbove, positionBelow

                    if (index === 0 && tree.parent) {
                        // Render precedent edge with tree bone

                        let [prevTree, prevIndex] = gametree.navigate(tree, index, -1)
                        let [px, py] = dict[prevTree.id + '-' + prevIndex]

                        positionAbove = [px * gridSize, py * gridSize]
                        positionBelow = [left, top]
                    } else {
                        // Render tree bone only

                        let [sx, sy] = dict[tree.id + '-0']

                        positionAbove = [sx * gridSize, sy * gridSize]
                        positionBelow = positionAbove
                    }

                    if (positionAbove != null && positionBelow != null) {
                        edges[!onCurrentTrack ? 'unshift' : 'push'](h(GameGraphEdge, {
                            key: tree.id,
                            positionAbove,
                            positionBelow,
                            length: (tree.nodes.length - 1) * gridSize,
                            current: onCurrentTrack,
                            gridSize
                        }))

                        doneTreeBones.push(tree.id)
                    }
                }

                if (index === tree.nodes.length - 1) {
                    // Render successor edges with subtree bones

                    for (let subtree of tree.subtrees) {
                        let current = onCurrentTrack && tree.subtrees[tree.current] === subtree
                        let [nx, ny] = dict[subtree.id + '-0']

                        edges[!current ? 'unshift' : 'push'](h(GameGraphEdge, {
                            key: subtree.id,
                            positionAbove: [left, top],
                            positionBelow: [nx * gridSize, ny * gridSize],
                            length: (subtree.nodes.length - 1) * gridSize,
                            current,
                            gridSize
                        }))

                        doneTreeBones.push(subtree.id)
                    }
                }
            }

            if (column.length > 0) nodeColumns.push(h('g', {key: x}, column))
        }

        return [h('g', {}, edges), h('g', {}, nodeColumns)]
    }

    render({
        height,
        treePosition,
        showGameGraph
    }, {
        matrixDict,
        viewportSize,
        cameraPosition: [cx, cy]
    }) {
        return h('section',
            {
                ref: el => this.element = el,
                id: 'graph'
            },

            h('style', {}, `
                #graph {
                    height: ${height}%;
                }
                #graph svg > * {
                    transform: translate(${-cx}px, ${-cy}px);
                }
            `),

            showGameGraph && matrixDict && viewportSize && h('svg',
                {
                    ref: el => this.svgElement = el,
                    width: viewportSize[0],
                    height: viewportSize[1],

                    onClick: this.handleNodeClick,
                    onContextMenu: this.handleNodeClick,
                    onMouseDown: this.handleGraphMouseDown,
                    onMouseUp: this.handleGraphMouseUp
                },

                this.renderNodes(this.props, this.state)
            )
        )
    }
}

module.exports = GameGraph
