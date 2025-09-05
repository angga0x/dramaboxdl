# DramaBox Telegram Downloader Bot

This is a powerful and user-friendly Telegram bot built with Node.js and Telegraf to download videos from DramaBox. It interacts with the DramaBox API to fetch episode lists and provide direct video files to the user.

## Features

- **Dynamic API Interaction:** Intelligently fetches all episodes for a given drama by handling the API's pagination.
- **Robust Authentication:** Automatically fetches and refreshes session tokens to ensure reliable communication with the DramaBox API. Includes a retry mechanism for transient authentication errors.
- **User-Friendly Interface:**
    - **Paginated Episode List:** Displays the episode list in clean, navigable pages with "Next" and "Previous" buttons.
    - **Seamless Video Navigation:** Each video sent to the user includes "Next Episode" and "Previous Episode" buttons for a continuous viewing experience.
    - **Informative Messages:** Provides clear loading and status messages.
- **Efficient Caching:** Caches the full episode list in memory to provide instant responses for subsequent user interactions (like pagination or chapter selection), minimizing API calls.
- **Direct Video Sending:** Sends video files directly to the user instead of just providing links.
- **Promotional System:** Sends a configurable promotional message to users after they have downloaded a certain number of videos.
- **Clean Codebase:** The project is well-structured with separate, single-responsibility modules for the bot logic (`bot.js`), API communication (`dramabox-api.js`), and logging (`logger.js`).
- **Detailed Logging:** Uses `pino` and `pino-pretty` for clear, readable logs, making development and debugging easier.

## Setup and Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/angga0x/dramaboxdl.git
    cd dramaboxdl
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure your bot token:**
    -   Create a file named `.env` in the root of the project.
    -   Add the following line to the `.env` file, replacing `YOUR_TELEGRAM_BOT_TOKEN` with your actual token from BotFather:
    ```
    TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
    ```

4.  **Run the bot:**
    ```bash
    node index.js
    ```

## How to Use

1.  Start a chat with your bot on Telegram and send the `/start` command.
2.  Send any valid DramaBox share link to the bot.
3.  The bot will reply with the drama's details and a paginated list of episodes.
4.  Use the "Next" and "Previous" buttons to navigate the episode list.
5.  Click on an episode button to get a quality selection.
6.  Choose your desired video quality.
7.  The bot will send the video file directly to you, with "Next Episode" and "Previous Episode" buttons to continue watching.

---

Made with ❤ by angga0x
