import { sendNotification } from '@tauri-apps/plugin-notification'

export async function notifySkillUpdated(name: string, version: string) {
  await sendNotification({
    title: 'Skill Updated',
    body: `${name} updated to ${version}`,
  })
}

export async function notifySyncCompleted(count: number) {
  await sendNotification({
    title: 'Sync Completed',
    body: `${count} skill${count === 1 ? '' : 's'} synchronised`,
  })
}

export async function notifyInstallResult(name: string, success: boolean) {
  await sendNotification({
    title: success ? 'Installation Successful' : 'Installation Failed',
    body: success ? `${name} installed successfully` : `Failed to install ${name}`,
  })
}

export async function notifyUpdateAvailable(name: string, newVersion: string) {
  await sendNotification({
    title: 'Update Available',
    body: `${name} v${newVersion} is available`,
  })
}
