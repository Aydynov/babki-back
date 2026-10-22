import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './modules/auth/decorators/public.decorator';
@Public()
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}
  @Get()
  getHealth() {
    return this.appService.getHealth();
  }
}
