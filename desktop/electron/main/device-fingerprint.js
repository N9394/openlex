/**
 * Stable device fingerprint — combines OS-provided machine identifiers
 * (which don't change across reboots, drive cloning is the main thing that
 * does change them) into a sha256 hash. Used by the license-server to bind
 * each lv_live_… token to a specific machine.
 *
 * Per platform:
 *   - Windows: HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid (set once by
 *     Windows Setup, survives all updates).
 *   - macOS:  IOPlatformUUID from ioreg (tied to the logic board).
 *   - Linux:  /etc/machine-id (set by systemd at install time).
 *
 * Combined with the CPU vendor + arch so a VM cloning the host's machine-id
 * still produces a distinct fingerprint when the CPU differs.
 *
 * Hash output: 32-char hex. ~16 bytes of entropy from sources that don't
 * change on routine OS updates or app reinstalls.
 */

const crypto = require('crypto')
const os = require('os')
const { execFileSync } = require('child_process')

function readWindowsMachineGuid() {
  try {
    const out = execFileSync('reg', [
      'query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid',
    ], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
    const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/)
    return m ? m[1] : null
  } catch { return null }
}

function readMacIOPlatformUUID() {
  try {
    const out = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
      encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
    })
    const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)
    return m ? m[1] : null
  } catch { return null }
}

function readLinuxMachineId() {
  try {
    const fs = require('fs')
    return fs.readFileSync('/etc/machine-id', 'utf8').trim() || null
  } catch {
    try {
      const fs = require('fs')
      return fs.readFileSync('/var/lib/dbus/machine-id', 'utf8').trim() || null
    } catch { return null }
  }
}

function deviceFingerprint() {
  let machineId = null
  if (process.platform === 'win32') machineId = readWindowsMachineGuid()
  else if (process.platform === 'darwin') machineId = readMacIOPlatformUUID()
  else if (process.platform === 'linux') machineId = readLinuxMachineId()

  const cpu = os.cpus()[0]?.model || 'unknown-cpu'
  const arch = process.arch
  const parts = [process.platform, arch, cpu, machineId || 'no-machine-id'].join('|')
  return crypto.createHash('sha256').update(parts).digest('hex').slice(0, 32)
}

function deviceLabel() {
  // Human-readable label for the user's "Manage devices" page. Combines
  // hostname + platform so they can tell which device they're looking at.
  const host = os.hostname() || 'unknown'
  const platform = process.platform === 'win32' ? 'Windows' :
                   process.platform === 'darwin' ? 'macOS' : 'Linux'
  return `${host} (${platform} ${process.arch})`
}

module.exports = { deviceFingerprint, deviceLabel }
