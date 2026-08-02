We want to come up with results to use for the results section of writeup-new-2.md, a blogpost for this project.

Run 3 runs each for openai/gpt-5.6-luna (OpenAI provider), deepseek/deepseek-v4-flash (Baidu Qianfan provider), z-ai/glm-5.2 (Baidu Qianfan provider). Reasoning must be off. To avoid rate limiting, run each run sequentially.

The runs must be stored in the /data folder, under the model name. Ex. data/gpt-5.6-luna for gpt-5.6-luna. Note that these providers are being used for some models because it supports structured json responses which we require. If there's any errors (ex. 429), note it down. Especially note down any schema failures or model provider failures.

Afterwards, analyze the results, and update writeup-new-2.md's results section.
 