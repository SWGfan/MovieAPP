import React, { useEffect, useState } from 'react'

export default function Emulators() {
  const [apps, setApps] = useState([])
  const [roms, setRoms] = useState([])
  const [selectedEmulator, setSelectedEmulator] = useState('')

  const scan = async () => {
    setApps(await window.movieapp.scanEmulatorApps())
    setRoms(await window.movieapp.scanRoms())
  }

  useEffect(() => {
    scan()
  }, [])

  const launch = (romPath) => {
    if (!selectedEmulator) {
      alert('Pick an emulator .exe first.')
      return
    }
    window.movieapp.launchEmulator(selectedEmulator, romPath)
  }

  return (
    <div>
      <div className="row">
        <select value={selectedEmulator} onChange={(e) => setSelectedEmulator(e.target.value)} style={{ flex: 1 }}>
          <option value="">Select emulator…</option>
          {apps.map((a) => (
            <option key={a.path} value={a.path}>{a.name}</option>
          ))}
        </select>
        <button className="primary" onClick={scan}>Rescan</button>
      </div>

      {apps.length === 0 && (
        <p className="empty-state">
          No emulator executables found. Add a legitimate emulator (e.g. RetroArch, Dolphin, PCSX2) to your Emulators folder.
        </p>
      )}

      {roms.length === 0 ? (
        <div className="empty-state">
          <p>No ROM files found.</p>
          <p>Add ROMs from games you legally own — this app won't download them for you.</p>
        </div>
      ) : (
        <div className="grid">
          {roms.map((r) => (
            <div className="card" key={r.path} onClick={() => launch(r.path)}>
              <div style={{ aspectRatio: '2/3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>🕹️</div>
              <div className="meta">
                <div className="title">{r.name}</div>
                <div className="sub">{r.ext.toUpperCase().slice(1)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
