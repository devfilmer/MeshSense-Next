<script context="module" lang="ts">
  import { writable } from 'svelte/store'
  export let newsVisible = writable(false)

  export let lastViewedNewsDate = Number(localStorage.getItem('lastViewedNewsDate')) || 0
</script>

<script>
  import Modal from './lib/Modal.svelte'
  import { meshSenseNewsDate, bluetoothInfo, pairingStatus, connectionStatus } from 'api/src/vars'
  console.log({ lastViewedNewsDate })
  /** The news would cover the pairing box or the connect progress; hold it back until those are out of the way */
  $: pairingNeeded =
    !!$bluetoothInfo?.needsPairing || $pairingStatus?.state == 'pairing' || ['searching', 'connecting', 'configuring', 'reconnecting'].includes($connectionStatus)
  $: if (lastViewedNewsDate < $meshSenseNewsDate && !pairingNeeded) {
    console.log({ lastViewedNewsDate, $meshSenseNewsDate })
    newsVisible.set(true)
    lastViewedNewsDate = $meshSenseNewsDate
    localStorage.setItem('lastViewedNewsDate', String($meshSenseNewsDate))
  }
</script>

<Modal title="Here's the latest from MeshSense (the project MeshSense Next is based on)" bind:visible={$newsVisible} fillHeight={true}>
  <div class="flex flex-col h-full gap-4">
    <iframe title="MeshSense News" src="https://affirmatech.com/meshsense/news?contentOnly=1&?timestamp={Date.now()}" class="grow h-full w-full"></iframe>
    <div>
      MeshSense Next is based on MeshSense by Affirmatech. Enjoying it? Please consider <a
        title="Support MeshSense (Affirmatech)"
        target="_blank"
        rel="noopener"
        class="btn text-sm hover:text-white"
        href="https://purchase.affirmatech.com/?productId=MeshSenseDonation">supporting their work</a
      > and future development. Thanks! 🙂
    </div>
  </div>
</Modal>
