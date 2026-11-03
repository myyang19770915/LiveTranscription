"""Run repeatable source-grounded regression examples against an OpenAI endpoint.
Usage: python evaluate_translation.py http://translate:5000 MODEL
Reports are evidence for manual review, not certification of professional quality.
"""
import asyncio, json, sys, time
import httpx
from translation_quality import policy, violations

CASES = [
    "n8n雖然是網頁模式，但是它是本地端引擎。我們介紹一個簡單的工作流。",
    "我的月報也是用這種流程自動化跑出來的，是可以做到的。",
    "我們整理mapping資料，再針對客戶手動調整每月的簡報。",
    "每月的營收、良率與設備稼動率，都可以從固定的資料來源取得。",
    "資料搬運可以透過RPA自動化作業，提高效率。我們從系統導到Excel，再敲Excel。",
    "為什麼？因為你們會發現，我們公司很多作業都需要手動輸入Excel。",
    "不是減少30%的人員，而是減少30%的資料輸入時間，目前還沒有正式上線。",
    "我們介紹的不是新的工作，而是可以串聯動作的工作流。",
    "總務人員正在處理付款申請，不是客戶在處理。",
    "你可以讓AI幫你做框架，再微調，但不能百分之百讓AI寫好所有邏輯，因此仍需理解流程自動化的基本概念。",
]

async def main():
    url, model = sys.argv[1:3]
    async with httpx.AsyncClient(timeout=120) as client:
        for source in CASES:
            started=time.monotonic()
            response=await client.post(url+'/v1/chat/completions',json={
                'model':model,'temperature':0,'repeat_penalty':1.0,'max_tokens':512,
                'chat_template_kwargs':{'enable_thinking':False},
                'messages':[{'role':'system','content':policy(source,'ja')},
                    {'role':'user','content':'Translate Chinese into Japanese.\nSOURCE:\n'+source}]})
            response.raise_for_status()
            choice=response.json()['choices'][0]
            out=choice['message']['content'].strip()
            print(json.dumps({'source':source,'translation':out,'issues':violations(source,out,'ja'),
                'finish':choice.get('finish_reason'),'ms':round((time.monotonic()-started)*1000)},ensure_ascii=False),flush=True)

if __name__=='__main__':
    asyncio.run(main())
