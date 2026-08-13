import { describe, expect, it, vi } from 'vitest'
import { ALLOWED_FIELDS, type LogFields, logger, scrub, timeStage } from './logger.js'

// A level low enough that nothing is filtered, which is the point: redaction
// must not depend on verbosity.
vi.mock('../config/env.js', () => ({ env: { LOG_LEVEL: 'debug' } }))

function captureLines(run: () => void): string[] {
  const lines: string[] = []
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    lines.push(String(chunk))
    return true
  })
  try {
    run()
  } finally {
    spy.mockRestore()
  }
  return lines
}

describe('field allowlist', () => {
  it('drops any field not on the allowlist', () => {
    const scrubbed = scrub({
      requestId: 'req-1',
      transcript: 'Patient reports a productive cough for five days',
      note: 'Assessment: likely viral URTI',
      editedNote: 'anything',
      analysis: 'anything',
      vault: 'anything',
      password: 'hunter2',
    })

    expect(Object.keys(scrubbed)).toEqual(['requestId'])
  })

  it('keeps LogFields and the field rules from drifting apart', () => {
    // Every optional key of LogFields, populated. If someone adds a field to
    // the interface without a matching rule it silently stops being logged;
    // this fails instead.
    const everyField: Required<LogFields> = {
      requestId: 'r',
      consultationId: 'c',
      actorId: 'a',
      method: 'GET',
      route: '/api',
      status: 200,
      durationMs: 1,
      stage: 'rules',
      operation: 'note_and_gaps',
      errorClass: 'model_error',
      errorName: 'Error',
      outcome: 'ok',
      detectorLabels: ['NRIC'],
      detectorCount: 1,
      provider: 'qwen',
      model: 'qwen-flash',
      count: 0,
    }

    expect(Object.keys(everyField).sort()).toEqual([...ALLOWED_FIELDS].sort())
    expect(Object.keys(scrub(everyField)).sort()).toEqual([...ALLOWED_FIELDS].sort())
  })
})

/**
 * The property that matters. Every allowlisted field is an enum, an identifier
 * or a number, so there is no field clinical prose can be assigned to. These
 * tests assert the rules reject rather than pass through, which is what makes
 * the boundary structural rather than probabilistic.
 */
describe('no field accepts free text', () => {
  it('rejects prose in every string-valued field', () => {
    const prose = 'Has Ahmad had any recent travel?'
    const stringFields = [
      'requestId',
      'consultationId',
      'actorId',
      'method',
      'route',
      'stage',
      'operation',
      'errorClass',
      'errorName',
      'outcome',
      'provider',
      'model',
    ] as const

    for (const field of stringFields) {
      const scrubbed = scrub({ [field]: prose })
      expect(scrubbed[field], `${field} accepted prose`).toBe('[redacted:invalid]')
    }
  })

  /**
   * The exact string that defeated the previous design. `deid`'s detector is
   * scored and context sensitive, so it scores this below `ACCEPT_THRESHOLD`
   * and lets it through. The field rule does not care.
   */
  it('rejects the phrasing the detector alone misses', () => {
    expect(scrub({ operation: 'Has Ahmad had any recent travel?' }).operation).toBe(
      '[redacted:invalid]',
    )
    expect(scrub({ operation: 'Advise Ahmad on fluids and rest.' }).operation).toBe(
      '[redacted:invalid]',
    )
  })

  it('refuses to serialise an object, however it arrives', () => {
    const consultation = {
      id: 'c1',
      transcript: { turns: [{ speaker: 'patient', text: 'I have chest pain' }] },
    }

    const scrubbed = scrub({ operation: consultation, consultationId: consultation })

    expect(scrubbed.operation).toBe('[redacted:invalid]')
    expect(JSON.stringify(scrubbed)).not.toContain('chest pain')
  })

  it('rejects a vault token wherever it is placed', () => {
    expect(scrub({ operation: '[PATIENT_1]' }).operation).toBe('[redacted:invalid]')
    expect(scrub({ consultationId: 'note for [PATIENT_1]' }).consultationId).toBe(
      '[redacted:invalid]',
    )
  })

  it('drops an unrecognised detector label rather than echoing it', () => {
    expect(scrub({ detectorLabels: ['NRIC', 'Ahmad bin Ismail', 'EMAIL'] }).detectorLabels).toEqual(
      ['NRIC', 'EMAIL'],
    )
  })

  it('leaves genuine operational values untouched', () => {
    const fields = {
      requestId: '0873d816-87c9-44fe-9e79-9e8734ec5b8b',
      consultationId: 'cmeg1q2r30000abcd1234efgh',
      method: 'POST',
      route: '/api/consultations/:id/analyze',
      operation: 'suggestions_and_red_flags',
      model: 'qwen-flash',
      provider: 'qwen',
      status: 200,
      durationMs: 42,
      stage: 'retrieval',
      errorClass: 'model_error',
      errorName: 'LLMResponseError',
      outcome: 'error',
      detectorLabels: ['NRIC', 'PATIENT'],
    }

    expect(scrub(fields)).toEqual(fields)
  })
})

describe('emitted records', () => {
  it('scrubs the message itself, not only the fields', () => {
    const [line] = captureLines(() => logger.info('analysing for Ahmad bin Ismail'))

    expect(line).not.toContain('Ahmad')
    expect(line).toContain('[redacted:')
  })

  it('escapes newlines so a message cannot forge a second log line', () => {
    const [line] = captureLines(() => logger.info('done\n{"level":"info","msg":"forged"}'))

    expect(line?.trimEnd().split('\n')).toHaveLength(1)
    expect(String(line)).not.toContain('"msg":"forged"')
  })

  it('emits one parseable JSON object per line', () => {
    const [line] = captureLines(() => logger.warn('request failed', { status: 409 }))
    const record = JSON.parse(line ?? '{}')

    expect(record).toMatchObject({ level: 'warn', msg: 'request failed', status: 409 })
    expect(typeof record.ts).toBe('string')
  })

  /**
   * Issue #15 non-goal: no debug flag may enable raw content logging, because
   * the flag itself becomes the vulnerability. Redaction sits at the
   * serialiser, so the most verbose level is exactly as safe as the least.
   */
  it('does not widen what may be written at debug level', () => {
    const [line] = captureLines(() =>
      logger.debug('trace', { operation: 'patient Ahmad bin Ismail said [PATIENT_1]' } as never),
    )

    expect(line).toBeDefined()
    expect(line).not.toContain('Ahmad')
    expect(line).not.toContain('[PATIENT_1]')
  })
})

describe('timeStage', () => {
  it('records duration and outcome without logging the stage result', async () => {
    const lines: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk))
      return true
    })

    const result = await timeStage('deidentification', async () => ({
      secret: 'Patient reports haemoptysis',
    }))
    spy.mockRestore()

    expect(result).toEqual({ secret: 'Patient reports haemoptysis' })
    expect(lines.join('')).not.toContain('haemoptysis')

    const record = JSON.parse(lines[0] ?? '{}')
    expect(record).toMatchObject({ stage: 'deidentification', outcome: 'ok' })
    expect(typeof record.durationMs).toBe('number')
  })

  it('records a failed stage by error class and rethrows', async () => {
    const lines: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk))
      return true
    })

    class LLMResponseError extends Error {
      override name = 'LLMResponseError'
    }
    const failing = timeStage('note_generation', async () => {
      throw new LLMResponseError('model returned: patient Ahmad has chest pain')
    })

    await expect(failing).rejects.toThrow()
    spy.mockRestore()

    const record = JSON.parse(lines[0] ?? '{}')
    expect(record).toMatchObject({
      stage: 'note_generation',
      outcome: 'error',
      errorName: 'LLMResponseError',
    })
    // The message is where the transcript fragment would be.
    expect(lines.join('')).not.toContain('chest pain')
  })
})
