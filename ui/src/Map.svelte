<script context="module" lang="ts">
  import { writable } from 'svelte/store'
  export let expandedMap = writable(false)
  export let setPositionMode = writable(false)
  import { generateHexer } from '@bdancer/icon-gaga'

  const svgUriCache = new Map<string, string>()

  /** Node icons are deterministic per name, so each is generated once */
  export function getSvgUri(name: string) {
    let uri = svgUriCache.get(name)
    if (!uri) {
      const hexId = parseInt(name).toString(16).padStart(8, '0')
      const colorId = hexId.slice(-6)
      uri = 'data:image/svg+xml;utf8,' + encodeURIComponent(generateHexer({ name, borderColor: `#${colorId}` }))
      svgUriCache.set(name, uri)
    }
    return uri
  }

  export function getIconURL(node: NodeInfo) {
    if (node.position?.latitudeI) {
      if (node?.position?.altitude > 2743) return `${import.meta.env.VITE_PATH || ''}/airplane.svg`
      else return getSvgUri(String(node.num))
      // else return `https://icongaga-api.bytedancer.workers.dev/api/genHexer?name=${node.num}`
    } else {
      return `${import.meta.env.VITE_PATH || ''}/circle-help.svg`
    }
  }
</script>

<script lang="ts">
  import { connectionStatus, myNodeNum, version, type NodeInfo } from 'api/src/vars'
  import { filteredNodes, isInactive, nodeVisibilityMode } from './Nodes.svelte'
  import Card from './lib/Card.svelte'
  import OpenLayersMap from './lib/OpenLayersMap.svelte'
  import { getCoordinates, getNodeById, getNodeName, getNodeNameById, setPosition } from './lib/util'
  import { showConfigModal, showPage } from './SettingsModal.svelte'
  import { newsVisible } from './News.svelte'
  import { onDestroy } from 'svelte'

  export let ol: OpenLayersMap = undefined

  $: nodesWithCoords = $filteredNodes.filter((n) => !(n.position?.latitudeI == undefined || n.position?.latitudeI == 0) || n.approximatePosition)

  function plotData() {
    let myNodeCoords = getCoordinates($myNodeNum)

    ol.plotLines(
      'routes',
      nodesWithCoords
        .filter((n) => (n.trace || n.hopsAway == 0) && $nodeVisibilityMode != 'inactive' && !n.trace?.route?.some((routeNodeId) => isInactive(getNodeById(routeNodeId))))
        .map((n) => {
          // A node now heard directly is drawn with a direct line, even if an earlier multi-hop route is still stored
          let route = n.hopsAway == 0 ? [] : n.trace?.route || []
          let list: any[] = [...route.map((traceNode) => getCoordinates(traceNode)), getCoordinates(n)]
          if (myNodeCoords[0] && myNodeCoords[1]) list.unshift(myNodeCoords)
          return list.filter((coords) => !(coords[0] == 0 && coords[1] == 0))
        })
    )

    ol.plotPoints(
      'nodes',
      nodesWithCoords.map((n) => {
        let [lon, lat] = getCoordinates(n)
        return {
          lat,
          lon,
          icon: getIconURL(n),
          description: getNodeName(n)
        }
      })
    )
  }

  let plotTimer: ReturnType<typeof setTimeout>
  let lastPlotTime = 0

  /** Redrawing rebuilds every map feature, so limit it to once per second */
  function schedulePlot() {
    if (plotTimer) return
    plotTimer = setTimeout(
      () => {
        plotTimer = undefined
        lastPlotTime = Date.now()
        if (ol) plotData()
      },
      Math.max(0, 1000 - (Date.now() - lastPlotTime))
    )
  }

  onDestroy(() => clearTimeout(plotTimer))

  $: {
    $myNodeNum, nodesWithCoords
    if (ol) schedulePlot()
  }

  let modalPage = 'Settings'
</script>

<Card title="Map" {...$$restProps}>
  <h2 slot="title" class="rounded-t flex items-center gap-1">
    <div class="mr-2">Map</div>

    <div class="grow">
      <button on:click={() => ($expandedMap = !$expandedMap)} class="btn font-normal text-xs">{$expandedMap ? 'Collapse' : 'Expand'}</button>
    </div>
    <div class="text-xs text-white/50 pr-2">MeshSense Next {$version}</div>
    <a href="https://affirmatech.com/meshsense" target="_blank" rel="noopener" title="MeshSense Next is based on MeshSense by Affirmatech" class="text-xs text-white/50 pr-2 font-normal">based on MeshSense by Affirmatech</a>
    <a title="Support MeshSense (Affirmatech)" target="_blank" rel="noopener" class="!text-rose-400 font-bold btn text-sm hover:brightness-110" href="https://purchase.affirmatech.com/?productId=MeshSenseDonation"
      >♥</a
    >
    <button title="What's New?" class="btn btn-sm h-6 grid place-content-center" on:click={() => newsVisible.set(true)}>📰</button>
    <a title="MeshSense Global Map" target="_blank" rel="noopener" class="font-bold btn text-sm hover:brightness-110" href="https://meshsense.affirmatech.com/">🌎</a>
    <button title="Settings" class="btn btn-sm h-6 font-normal grid place-content-center" on:click={() => showPage('Settings')}>⚙</button>
  </h2>
  <OpenLayersMap
    bind:this={ol}
    center={JSON.parse(localStorage.getItem('mapCenter')) ?? getCoordinates($myNodeNum)}
    zoom={JSON.parse(localStorage.getItem('mapZoom'))}
    onMove={(center, zoom) => {
      localStorage.setItem('mapCenter', JSON.stringify(center))
      localStorage.setItem('mapZoom', JSON.stringify(zoom))
    }}
    onClick={(latitude, longitude) => {
      if ($setPositionMode) {
        $setPositionMode = false
        setPosition(latitude, longitude)
      }
    }}
    onDarkModeToggle={plotData}
  ></OpenLayersMap>
  {#if $setPositionMode}
    <div class="absolute select-none top-10 left-10 bg-indigo-600/80 text-white p-3 py-1 rounded-lg">
      Click on a new position for {getNodeNameById($myNodeNum)}
      <button title="Cancel selecting a position" class="btn btn-sm ml-2 font-bold !text-red-200 !from-rose-500 !to-rose-800 rounded-full" on:click={() => ($setPositionMode = false)}>X</button>
    </div>
  {/if}
</Card>
