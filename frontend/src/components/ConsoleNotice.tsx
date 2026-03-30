import { useEffect, useState } from 'react'

type ConsoleNoticeProps = {
  message: string
  onClose: () => void
}

const NOTICE_VISIBLE_MS = 3400
const NOTICE_LEAVE_MS = 700

export default function ConsoleNotice({ message, onClose }: ConsoleNoticeProps) {
  const [isLeaving, setIsLeaving] = useState(false)

  useEffect(() => {
    if (message.trim() === '') {
      return
    }

    setIsLeaving(false)

    const fadeTimer = window.setTimeout(() => {
      setIsLeaving(true)
    }, NOTICE_VISIBLE_MS)

    const closeTimer = window.setTimeout(() => {
      onClose()
      setIsLeaving(false)
    }, NOTICE_VISIBLE_MS + NOTICE_LEAVE_MS)

    return () => {
      window.clearTimeout(fadeTimer)
      window.clearTimeout(closeTimer)
    }
  }, [message, onClose])

  if (message.trim() === '') {
    return null
  }

  return (
    <div className={`console-notice ${isLeaving ? 'is-leaving' : 'is-visible'}`}>
      {message}
    </div>
  )
}
