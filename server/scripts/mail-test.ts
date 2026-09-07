import 'dotenv/config'
import { fromAddress, otpEmail, provider, sendMail, verifyMail } from '../mailer.js'

// Check email delivery, the thing sign-in depends on.
//   npm run mail:test              → verify the credentials only
//   npm run mail:test you@you.com  → verify, then send a real test message

const [to] = process.argv.slice(2)

console.log(`Provider : ${provider()}`)
console.log(`From     : ${fromAddress()}`)

const check = await verifyMail()
console.log(`${check.ok ? '✅' : '❌'} ${check.detail}`)
if (!check.ok) process.exit(1)

if (!to) {
  console.log('\nPass an address to send a real test message: npm run mail:test you@example.com')
  process.exit(0)
}

const result = await sendMail({ to, ...otpEmail('123456', 'login') })
console.log(`${result.ok ? '✅' : '❌'} ${result.detail}`)
process.exit(result.ok ? 0 : 1)
