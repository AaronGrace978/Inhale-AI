import { useEffect, useMemo } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { GraphSnapshot, ShardNode as ShardData } from '../../../shared/types'
import { formatTokens } from '../format'
import { useAppState } from '../state'

function CoreNode({ data }: { data: GraphSnapshot['identity'] }) {
  return (
    <div className="core-node">
      <Handle type="source" position={Position.Right} style={{ opacity: 0, top: '50%', left: '50%' }} />
      <b>Identity Core</b>
      <em>locked</em>
      <span>{formatTokens(data.tokenCount)} tokens</span>
    </div>
  )
}

function ShardNode({ data }: { data: ShardData & { compact?: boolean } }) {
  const compact = Boolean(data.compact) && !data.active
  return (
    <div className={compact ? 'shard-node compact' : data.active ? 'shard-node live' : 'shard-node'} title={data.title}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0, top: '50%', left: '50%' }} />
      <b>{data.title}</b>
      <span>
        v{data.version} · {formatTokens(data.tokenCount)}
      </span>
    </div>
  )
}

const nodeTypes = { core: CoreNode, shard: ShardNode }

function layout(snapshot: GraphSnapshot): { nodes: Node[]; edges: Edge[] } {
  const count = snapshot.shards.length
  const compact = count > 14
  const pitch = compact ? 42 : 196
  const radius = Math.max(compact ? 210 : 250, (count * pitch) / (2 * Math.PI))
  const nodes: Node[] = [
    {
      id: 'identity-core',
      type: 'core',
      position: { x: -90, y: -58 },
      data: { ...snapshot.identity },
      draggable: false,
      selectable: true
    }
  ]
  const edges: Edge[] = []
  snapshot.shards.forEach((shard, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(count, 1) - Math.PI / 2
    const half = shard.active || !compact ? 78 : 14
    nodes.push({
      id: shard.id,
      type: 'shard',
      position: { x: Math.cos(angle) * radius - half, y: Math.sin(angle) * radius - (shard.active || !compact ? 32 : 14) },
      data: { ...shard, compact },
      draggable: true
    })
    edges.push({
      id: `edge-${shard.id}`,
      source: 'identity-core',
      target: shard.id,
      animated: shard.active,
      style: {
        stroke: shard.active ? '#ff6fae' : 'rgba(255, 176, 214, 0.9)',
        strokeWidth: shard.active ? 3.2 : compact ? 5 : 1.6
      }
    })
  })
  return { nodes, edges }
}

function GraphCanvas() {
  const { state, dispatch } = useAppState()
  const snapshot = state.graph
  const flow = useReactFlow()
  const model = useMemo(() => (snapshot ? layout(snapshot) : layout(emptySnapshot())), [snapshot])
  const [nodes, setNodes, onNodesChange] = useNodesState(model.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(model.edges)

  useEffect(() => {
    setNodes(model.nodes)
    setEdges(model.edges)
    const frame = requestAnimationFrame(() => {
      const mounted = snapshot?.mountedIds ?? []
      const many = (snapshot?.shards.length ?? 0) > 14
      if (mounted.length > 0 && !many) {
        void flow.fitView({
          nodes: [{ id: 'identity-core' }, ...mounted.map((id) => ({ id }))],
          padding: 0.35,
          duration: 420,
          maxZoom: 1.15
        })
        return
      }
      void flow.fitView({ padding: 0.16, duration: 420, maxZoom: 1.15 })
    })
    return () => cancelAnimationFrame(frame)
  }, [flow, model.edges, model.nodes, setEdges, setNodes, snapshot])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      colorMode="dark"
      minZoom={0.15}
      maxZoom={1.6}
      nodesConnectable={false}
      proOptions={{ hideAttribution: false }}
      onNodeClick={(_event, node) => {
        const bridge = window.kirby
        if (!bridge) return
        void bridge
          .readShard(node.id)
          .then((shard) => dispatch({ type: 'shard', shard }))
          .catch((error: unknown) => {
            dispatch({ type: 'error', error: error instanceof Error ? error.message : 'Could not read that skill.' })
          })
      }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color="rgba(255, 170, 205, 0.35)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}

function emptySnapshot(): GraphSnapshot {
  return {
    identity: { id: 'identity-core', title: 'Identity Core', tokenCount: 0, locked: true },
    shards: [],
    mountedIds: [],
    baselineTokens: 0,
    strippedTokens: 0,
    registryTokens: 0,
    activeTokens: 0,
    reduction: 0,
    reductionMode: 'projected'
  }
}

export function SkillGraph() {
  const { state } = useAppState()
  const mounted = state.graph?.mountedIds.length ?? 0
  const dormant = Math.max(0, (state.graph?.shards.length ?? 0) - mounted)
  return (
    <section className="panel graph-panel">
      <header className="panel-head">
        <div>
          <p className="eyebrow">Skill graph</p>
          <h2>Identity at the center</h2>
        </div>
        <p className="legend">
          <i className="dot live" /> mounted {mounted}
          <i className="dot" /> {dormant} dormant
        </p>
      </header>
      <div className="graph-canvas">
        <ReactFlowProvider>
          <GraphCanvas />
        </ReactFlowProvider>
      </div>
    </section>
  )
}
