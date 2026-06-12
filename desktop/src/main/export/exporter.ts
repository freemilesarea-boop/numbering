// 결과 파일 저장기 (CSV / XLSX).
//
// 요구사항의 결과 파일 컬럼 순서를 그대로 사용한다:
//   store_name, address, safe_phone, mobile_phone,
//   instagram_url, homepage_url, naver_map_url, collected_at

import { promises as fs } from 'fs'
import * as XLSX from 'xlsx'
import type { CollectedPlace, ExportFormat } from '../../shared/types'

const COLUMNS: Array<keyof CollectedPlace> = [
  'store_name',
  'address',
  'safe_phone',
  'mobile_phone',
  'instagram_url',
  'homepage_url',
  'naver_map_url',
  'collected_at'
]

/** CSV 한 셀 이스케이프(쉼표/따옴표/개행 포함 시 따옴표로 감싼다). */
function escapeCsv(value: string): string {
  const v = value ?? ''
  if (/[",\n\r]/.test(v)) {
    return '"' + v.replace(/"/g, '""') + '"'
  }
  return v
}

function toCsv(places: CollectedPlace[]): string {
  const header = COLUMNS.join(',')
  const rows = places.map((p) => COLUMNS.map((c) => escapeCsv(String(p[c] ?? ''))).join(','))
  // 엑셀에서 한글이 깨지지 않도록 UTF-8 BOM을 붙인다.
  return '﻿' + [header, ...rows].join('\r\n')
}

async function writeCsv(places: CollectedPlace[], filePath: string): Promise<void> {
  await fs.writeFile(filePath, toCsv(places), 'utf-8')
}

async function writeXlsx(places: CollectedPlace[], filePath: string): Promise<void> {
  const rows = places.map((p) => {
    const row: Record<string, string> = {}
    for (const c of COLUMNS) row[c] = String(p[c] ?? '')
    return row
  })
  const sheet = XLSX.utils.json_to_sheet(rows, { header: COLUMNS as string[] })
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'collected_places')
  XLSX.writeFile(book, filePath)
}

/** 형식에 맞게 파일을 저장한다. */
export async function exportPlaces(
  places: CollectedPlace[],
  filePath: string,
  format: ExportFormat
): Promise<void> {
  if (format === 'csv') await writeCsv(places, filePath)
  else await writeXlsx(places, filePath)
}

/** 기본 파일명 제안값 (leads_{위치}_{업종}_{YYYY-MM-DD}.{ext}). */
export function suggestFileName(
  location: string,
  keyword: string,
  format: ExportFormat
): string {
  const date = new Date().toISOString().slice(0, 10)
  const safe = (s: string): string => (s || '').replace(/[\\/:*?"<>|]/g, '').trim() || 'all'
  return `leads_${safe(location)}_${safe(keyword)}_${date}.${format}`
}
