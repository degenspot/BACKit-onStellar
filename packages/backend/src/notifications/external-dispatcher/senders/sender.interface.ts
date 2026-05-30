import { NotificationEntity } from '../../notification.entity';

export interface ISender {
  send(notification: NotificationEntity): Promise<void>;
}
