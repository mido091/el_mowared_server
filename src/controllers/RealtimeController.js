import {
  authorizePusherChannel,
  handlePresenceSync,
  handleMessageReadEvent,
  handleTypingEvent
} from '../config/socket.js';

class RealtimeController {
  authorizeChannel = async (req, res, next) => {
    try {
      const authPayload = await authorizePusherChannel({
        socketId: req.body.socket_id,
        channelName: req.body.channel_name,
        user: req.user
      });

      res.send(authPayload);
    } catch (error) {
      next(error);
    }
  };

  typing = async (req, res, next) => {
    try {
      const data = await handleTypingEvent({
        user: req.user,
        conversationId: req.body.conversationId,
        state: req.body.state
      });

      res.status(200).json({
        success: true,
        data,
        message: 'Realtime typing event dispatched successfully.'
      });
    } catch (error) {
      next(error);
    }
  };

  presence = async (req, res, next) => {
    try {
      const data = await handlePresenceSync({
        user: req.user,
        state: req.body.state
      });

      res.status(200).json({
        success: true,
        data,
        message: 'Presence state synced successfully.'
      });
    } catch (error) {
      next(error);
    }
  };

  read = async (req, res, next) => {
    try {
      const data = await handleMessageReadEvent({
        user: req.user,
        conversationId: req.body.conversationId,
        messageId: req.body.messageId
      });

      res.status(200).json({
        success: true,
        data,
        message: 'Realtime read receipt dispatched successfully.'
      });
    } catch (error) {
      next(error);
    }
  };
}

export default new RealtimeController();
