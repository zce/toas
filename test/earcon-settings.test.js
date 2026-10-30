import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import { expectEqual, expectTruthy, run, test } from './harness.js'
const read=p=>new TextDecoder().decode(GLib.file_get_contents(p)[1])
test('earcons default on, choices stay independent and disabled mode has one switch',()=>{
 const xml=read('schemas/org.gnome.shell.extensions.toas.gschema.xml')
 const prefs=read('prefs.js')
 expectTruthy(xml.includes('<key name="sound-enabled" type="b">\n      <default>true</default>'))
 expectTruthy(xml.includes("<key name=\"sound-start-style\" type=\"s\">\n      <default>'crystal'</default>"))
 expectTruthy(xml.includes("<key name=\"sound-end-style\" type=\"s\">\n      <default>'tap'</default>"))
 expectTruthy(prefs.includes("settings.bind('sound-enabled', cueEnabled, 'active'"))
 expectTruthy(prefs.includes("group.add(soundRow('start', 'Start sound'))"))
 expectTruthy(prefs.includes("group.add(soundRow('end', 'Stop sound'))"))
})
await run()
