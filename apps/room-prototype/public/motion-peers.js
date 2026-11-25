// Each authenticated room socket owns one endpoint. Record permissions and channels stay independent.
export function createMotionPeers({ getConfig, signal, receive, recover }) {
  const links = new Map();
  let snapshot, settings, settingsAt = 0;
  function drop(id, link) {
    if (links.get(id) !== link) return;
    links.delete(id);
    link.pc.close();
    if (snapshot?.peers.some(p => p.peerId === id)) recover(id);
  }
  async function configure(id, offer) {
    if (!globalThis.RTCPeerConnection || !globalThis.crypto?.randomUUID || !snapshot || links.has(id)) return;
    const self = snapshot.selfPeerId;
    if (Date.now() - settingsAt > 1800000 || !settings) {
      settingsAt = Date.now();
      settings = getConfig().catch(error => { settings = null; throw error; });
    }
    const config = await settings;
    if (snapshot?.selfPeerId !== self || links.has(id) || !snapshot.peers.some(p => p.peerId === id)) return;
    const pc = new RTCPeerConnection(config);
    const link = { pc, token: offer?.connectionId ?? crypto.randomUUID(), started: Date.now() };
    links.set(id, link);
    function attach(channel) {
      if (channel.label !== "bookmate-motion" || link.channel) { channel.close(); return; }
      link.channel = channel;
      channel.onmessage = ({data}) => {
        if (links.get(id) !== link || typeof data !== "string" || data.length > 240) return;
        try { receive(id, JSON.parse(data)); } catch { /* Ignore malformed coordinates. */ }
      };
      channel.onclose = () => drop(id, link);
      channel.onerror = () => drop(id, link);
    }
    pc.onconnectionstatechange = () => {
      if (["disconnected", "failed", "closed"].includes(pc.connectionState)) drop(id, link);
    };
    try {
      if (offer) {
        pc.ondatachannel = ({ channel }) => attach(channel);
        await pc.setRemoteDescription(offer.payload);
      } else {
        // Reliable delivery also carries the final stop; sequence numbers supersede late samples.
        attach(pc.createDataChannel("bookmate-motion", { ordered: false }));
      }
      await pc.setLocalDescription(offer ? await pc.createAnswer() : await pc.createOffer());
      // Batch candidates in SDP: even nine simultaneous negotiations need only one signal per peer.
      if (pc.iceGatheringState !== "complete") await new Promise(resolve => {
        function finish() {
          clearTimeout(timer);
          pc.removeEventListener("icegatheringstatechange", changed);
          resolve();
        }
        function changed() { if (pc.iceGatheringState === "complete") finish(); }
        const timer = setTimeout(finish, 4000);
        pc.addEventListener("icegatheringstatechange", changed);
      });
      if (links.get(id) !== link) return;
      // The live socket also carries presence. Oversized SDP must never close that socket.
      if (new TextEncoder().encode(JSON.stringify(pc.localDescription)).length > 15000) drop(id, link);
      else signal(id, link.token, pc.localDescription.toJSON());
    } catch { drop(id, link); }
  }
  function update(next) {
    const reset = snapshot?.selfPeerId !== next?.selfPeerId;
    snapshot = next;
    for (const [id, link] of links)
      if (reset || !next?.peers.some(p => p.peerId === id) ||
          (link.channel?.readyState !== "open" && Date.now() - link.started > 20000)) drop(id, link);
    for (const {peerId} of next?.peers ?? [])
      if (next.selfPeerId < peerId) void configure(peerId).catch(() => {});
  }
  async function handle(msg) {
    const id = msg.fromPeerId;
    if (!snapshot?.peers.some(p => p.peerId === id)) return;
    const link = links.get(id);
    if (msg.kind === "offer" && id < snapshot.selfPeerId) {
      if (link?.token === msg.connectionId) return;
      if (link) drop(id, link);
      await configure(id, msg);
    } else if (msg.kind === "answer" && link?.token === msg.connectionId) {
      try { await link.pc.setRemoteDescription(msg.payload); } catch { drop(id, link); }
    }
  }
  return {
    update,
    handle: msg => void handle(msg).catch(() => {}),
    send(id, frame) {
      const channel = links.get(id)?.channel;
      if (channel?.readyState !== "open" || channel.bufferedAmount > 8192) return false;
      try { channel.send(frame); return true; } catch { return false; }
    },
  };
}
