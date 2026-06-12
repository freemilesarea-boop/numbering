// 중복 제거 / 전화번호 분류 유틸 (dedupe.py 포팅 + 확장).
//
// 중복 판정 기준 (요구사항):
//   네이버지도 URL 또는 (매장명 + 주소) 기준으로 제거.

import type { CollectedPlace } from '../../shared/types'

// 매장명/주소 정규화 시 제거할 특수문자(공백 포함).
const SPECIAL_CHARS = /[\s\-_.,()[\]{}'"~!@#$%^&*+=/\\|<>?:;]/g

/** 전화번호에서 숫자만 남긴다. 예) '02-123-4567' -> '021234567'. */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return ''
  return phone.replace(/\D/g, '')
}

/** 매장명/주소 비교용 정규화. 공백/특수문자 제거 + 소문자 변환. */
export function normalizeText(text: string | null | undefined): string {
  if (!text) return ''
  return text.replace(SPECIAL_CHARS, '').toLowerCase()
}

/**
 * 전화번호를 (안심번호/대표번호, 휴대폰번호)로 분리한다.
 * - 010/011/016/017/018/019 로 시작 → 휴대폰번호(mobile_phone)
 * - 그 외(0507 안심번호, 02/0xx 대표번호 등) → safe_phone
 */
export function classifyPhone(phone: string): { safe: string; mobile: string } {
  const digits = normalizePhone(phone)
  if (!digits) return { safe: '', mobile: '' }
  if (/^01[016789]/.test(digits)) return { safe: '', mobile: phone }
  return { safe: phone, mobile: '' }
}

/**
 * 매장 한 건의 중복 판정 키를 만든다.
 * 1순위: 네이버지도 URL
 * 2순위: 매장명 + 주소 정규화 값
 */
export function dedupeKey(place: CollectedPlace): string {
  const url = (place.naver_map_url || '').trim()
  if (url) return `url:${url}`
  const name = normalizeText(place.store_name)
  const address = normalizeText(place.address)
  return `na:${name}|${address}`
}
