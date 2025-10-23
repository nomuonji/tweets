import { NextResponse } from 'next/server';
import puppeteer from 'puppeteer-core';
import chromium from 'chrome-aws-lambda';

async function getBrowser() {
  if (process.env.NODE_ENV === 'development') {
    // 開発環境ではローカルのChromeを使用
    return puppeteer.launch({
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', // ご自身のChromeのパスに適宜変更してください
      headless: true,
    });
  }
  // Vercelなどの本番環境
  return chromium.puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
  });
}

export async function POST(request: Request) {
  let browser = null;
  try {
    const body = await request.json();
    const { url } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ ok: false, message: 'URL is required.' }, { status: 400 });
    }

    browser = await getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });

    let text = '';
    let author_handle = '';
    let platform: 'x' | 'threads' = 'x';

    if (url.includes('twitter.com') || url.includes('x.com')) {
      platform = 'x';
      author_handle = url.split('/')[3] || 'unknown';
      
      // tweetTextのセレクタを待つ
      await page.waitForSelector('[data-testid="tweetText"]', { timeout: 5000 });
      text = await page.$eval('[data-testid="tweetText"]', (el) => el.textContent?.trim() || '');

    } else if (url.includes('threads.net')) {
      platform = 'threads';
      author_handle = url.split('/')[2]?.substring(1) || 'unknown';
      // Threadsのセレクタ (要検証)
      await page.waitForSelector('p', { timeout: 5000 });
      text = await page.$eval('p', (el) => el.textContent?.trim() || '');
    } else {
      return NextResponse.json({ ok: false, message: 'Unsupported URL.' }, { status: 400 });
    }

    if (!text) {
      return NextResponse.json({ ok: false, message: 'Could not extract post text.' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      post: {
        text,
        author_handle,
        platform,
        url,
      },
    });

  } catch (error) {
    console.error('Scraping error:', error);
    return NextResponse.json({ ok: false, message: `Scraping failed: ${(error as Error).message}` }, { status: 500 });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}